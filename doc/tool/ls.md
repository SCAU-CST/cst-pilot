# ls：目录大小浏览

列出目录的直接子项，按大小排序，适合逐层查找空间占用。需要整棵目录树的大文件、扩展名或旧文件排行时，使用 [disk usage](disk.md#usage占用分析)。

实现：[ls.ts](../../agent/home/extensions/diagnostics/ls.ts)。本工具覆盖 pi 内置 `ls`，保留目录浏览入口并补充大小和占比。

## 调用

```js
ls({ path: "C:\\Users", top: 10 })
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 目录路径 |
| `top` | 否 | 返回项数，默认 20，最大 50 |

## 返回

| 字段 | 说明 |
|---|---|
| `path` | 规范化后的目录路径 |
| `totalChildren` | 直接子项数 |
| `totalSize` | 已统计子项的大小合计；不完整时为下界 |
| `method` | `wiztree-index`：使用共享缓存；`walk`：递归统计 |
| `entries[]` | 大小倒序；每项包含 `name`、`type`、`size`、`bytes`、`pct` |
| `omitted` | 截断时返回剩余项数、已知大小合计及 `unknownCount` |
| `notice` | 权限或预算导致统计不完整时说明原因 |

`type` 为 `dir`、`file` 或 `unknown`。无法确定大小时，`bytes` 和 `size` 为 `null`，不会当成 0；数据不完整或合计为 0 时，`pct` 为 `null`。

```json
{
  "path": "C:\\Example",
  "totalChildren": 2,
  "totalSize": "3.0 MB",
  "method": "walk",
  "entries": [
    { "name": "data.bin", "type": "file", "size": "3.0 MB", "bytes": 3145728, "pct": null },
    { "name": "locked", "type": "unknown", "size": null, "bytes": null, "pct": null }
  ],
  "notice": "部分子项大小未统计完整（熔断或无权限），所示大小为下界"
}
```

路径不存在等错误返回 `{ "error": "原因" }`。

## 大小来源

```mermaid
flowchart LR
    A[目录查询] --> B[校验卷身份并查询共享缓存]
    B -->|命中| C[读取目录和大文件大小]
    B -->|缺失或不可用| D[递归统计]
    C --> E[排序并返回前 N 项]
    D --> E
```

[共享缓存](wz-index.md) 缺失时可能先触发全盘 WizTree 扫描。后续查询可复用已缓存的路径，但同一卷内的文件变化不会实时刷新。

递归路径共用 **50 万条目、30 秒**预算，目录和文件均计入；达到任一限制后停止继续遍历，并标注下界。递归遇到符号链接或 junction 时跳过以避免环路。

同步 stat 失败后尝试异步 stat，再查询目录或大文件缓存；仍不可读则保留未知状态。大小为 0 的文件也会尝试用大文件缓存补充，以处理部分系统独占文件的读取限制。递归统计结果不写入共享缓存，避免将不完整数据长期复用。

## 限制

- 首次建缓存耗时取决于卷大小、文件数量、权限和介质速度，不能保证秒回。
- UNC 路径不建共享缓存，使用递归统计。
- `totalSize` 是已统计大小，不等于物理分配空间；存在未知条目时不能据此推断目录总量。
