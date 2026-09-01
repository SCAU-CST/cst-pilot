# ls — 目录浏览工具

实现：`agent\home\extensions\ls.ts`。覆盖 pi 内置 ls。

## 背景

维修场景的第一步往往是"C 盘怎么满了，这个目录下谁占得最多"。
pi 内置 ls 的先天缺陷：stat 已经拿到文件大小，输出时却丢弃——
模型只看到文件名列表，回答不了体积分布问题。

本工具以同名覆盖内置（扩展后注册即覆盖，模型零学习成本）：
输出仍是目录列表，但每项带上大小和占比。

## 调用方式

| 参数 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 要浏览的目录 |
| `top` | 否 | 返回前 N 项，默认 20，上限 50 |

## LLM 收到的提示词（逐字实录）

系统提示词 `Available tools:` 列表中的行：

```
- ls: List directory contents with sizes and percentages (read-only)
```

系统提示词 `Guidelines:` 中的条目：

```
- Use ls to browse a directory's size distribution; use disk scope=usage for full-tree analysis of large paths.
```

Function schema（每次请求的 tools 数组中）：

```jsonc
{
  "name": "ls",
  "description": "列出目录的直接子项（文件和子文件夹），按占用大小从大到小排序，默认返回最大的前 20 项。文件显示字节大小，子文件夹显示递归聚合大小，每项附带占父目录的百分比。若被截断，会报告剩余项数与合计。用于浏览任意目录的内容与体积分布。",
  "parameters": {
    "type": "object",
    "required": ["path"],
    "properties": {
      "path": { "type": "string", "description": "要浏览的目录路径" },
      "top":   { "type": "number", "description": "返回前 N 项（默认 20，最大 50）" }
    }
  }
}
```

## 调用与输出实例

```
ls({ path: "E:\\Learning\\Programming\\cst-pilot", top: 5 })
```

```jsonc
{
  "path": "E:\\Learning\\Programming\\cst-pilot",
  "totalChildren": 7,
  "totalSize": "528.1 MB",
  "method": "wiztree-index",          // 走了共享账本，见 wz-index.md
  "entries": [                        // 按大小倒序
    { "name": "pwsh",   "type": "dir",  "size": "244.7 MB", "bytes": 256592846, "pct": 46.3 },
    { "name": "agent",  "type": "dir",  "size": "169.6 MB", "bytes": 177848769, "pct": 32.1 },
    { "name": "node",   "type": "dir",  "size": "94.9 MB",  "bytes": 99511443,  "pct": 18 },
    { "name": "wiztree","type": "dir",  "size": "18.8 MB",  "bytes": 19749559,  "pct": 3.6 },
    { "name": "doc",    "type": "dir",  "size": "26.2 KB",  "bytes": 26801,     "pct": 0 }
  ],
  "omitted": {                        // 被截掉的项不静默丢弃
    "count": 2,
    "size": "3.1 KB",
    "note": "已按大小截断，其余为小项"
  }
}
```

本次实测 12.7 秒：这是该盘在本进程内的**首次**查询，触发了 WizTree
全盘扫描建账。之后同盘任意路径秒回。

出错时的形态：

```jsonc
{ "error": "路径不存在: C:\\not-exist-dir-xyz" }
```

## 实现

### 大小引擎：两级

```
ensureIndex(target)          ← wz-index 共享账本（见 wz-index.md）
  ├─ 账本命中 → 直接查 Map，同盘任意路径秒回（method: "wiztree-index"）
  └─ 缺账/无账本 → walkSize() 递归累计（method: "walk"）
```

walkSize 降级路径有两个熔断：最多 stat 50 万个文件、总时长 30 秒。
任一触发后输出 `notice: "所示大小为下界"`。符号链接 / junction 一律跳过防环路。

### 假 0 兜底

`statSync` 对 pagefile.sys 等系统独占文件返回大小 0（无法真正打开）。
文件大小为 0 时查 wz-index 的文件账本（MFT 真实字节）兜底。

### stat 失败的补查链

权限不足或文件锁定导致同步 stat 抛异常时，依次尝试：
异步 `fsp.stat` 补查 → 目录查账本 `dirs` / 文件查账本 `files` → 记 0 并标记不完整。

## 取舍

| 决策 | 备选 | 理由 |
|---|---|---|
| 覆盖内置 ls | 新工具名 | `ls` 是模型列目录的第一反射；新名字要先学存在，还可能先调内置拿到无用结果 |
| 目录大小走账本 | 每次实时递归 | 实时递归在大目录上分钟级；账本让同盘第二次查询秒回 |
| walk 结果不入账本 | 降级数据也缓存 | walk 是熔断下界，入账会永久污染账本精度（详见 wz-index.md） |
| 截断 + omitted 汇总 | 全量返回 / 纯截断 | 全量在万级子项目录撑爆上下文；纯截断让模型误以为列表完整 |
| 输出带 pct | 只给绝对值 | 维修人员关心"谁占大头"，百分比比字节数直接 |

## 已知限制

- 冷启动首次查询要等全盘扫描（数十秒），之后同盘秒回
- walk 降级路径的文件夹大小是下界（权限目录未计入）
- UNC 路径（网络共享）无账本，恒走 walk
