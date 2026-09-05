# 工具文档

本目录说明六个只读诊断工具的调用方式、返回字段和限制。设计理由见 [design](../design/sys_design.md)，验证方法见 [测试指南](../test/README.md)。

| 要解决的问题 | 工具 | 实现 |
|---|---|---|
| 目录里谁占空间 | [ls](ls.md) | [ls.ts](../../agent/home/extensions/ls.ts) |
| 磁盘容量、型号、健康与占用 | [disk](disk.md) | [disk.ts](../../agent/home/extensions/disk.ts) |
| CPU、内存、GPU、IO 与传感器 | [sys](sys.md) | [sys.ts](../../agent/home/extensions/sys.ts) |
| 开机会启动什么 | [startup](startup.md) | [startup.ts](../../agent/home/extensions/startup.ts) |
| 崩溃、蓝屏、服务与登录历史 | [eventlog](eventlog.md) | [eventlog-core.ts](../../agent/home/extensions/eventlog-core.ts) |
| 设备识别与驱动状态 | [driver](driver.md) | [driver-core.ts](../../agent/home/extensions/driver-core.ts) |
| 维护共享目录大小缓存 | [wz-index](wz-index.md)（内部模块） | [wz-index.ts](../../agent/home/extensions/wz-index.ts) |

## 使用约定

- 支持范围为 Windows 10/11 x64；裁剪系统、PE 和特殊介质的可用性需单独验证。
- 工具不改注册表、设备状态或系统配置。存储扫描会在 `wiztree/tmp` 写入临时 CSV，并在结束时尝试清理；目录大小缓存保存在进程内。
- 文档中的 `工具名({...})` 是工具调用示意，不是可直接粘贴到 PowerShell 的命令。
- 多功能工具用 `scope` 选择子功能；`ls`、`startup` 不使用 scope。各工具的必填参数见对应页面。
- 示例数值仅用于说明字段，不能作为其他机器的通过标准。

## 返回结构

模型读取 `content` 中的 JSON 文本。多数工具同时返回 `details` 供 TUI 渲染；`ls` 只返回文本。需要模型获知的信息必须出现在文本中。

```ts
{ content: [{ type: "text", text: JSON.stringify(result) }], details: result }
```

业务数据的包装并不完全相同：`sys`、`driver`、`eventlog` 按 scope 包装，`startup` 使用 `startup` 字段；`disk` 按数据种类返回，`ls` 直接返回目录对象。

| 字段 | 如何理解 |
|---|---|
| `notice` / `*Notice` | 数据口径、缺失能力或降级原因 |
| `error` | 当前查询或数据源失败；可能位于子对象内 |
| `degraded` / `collectionErrors` | 部分采集失败，成功字段仍可使用 |
| `counterErrors` / `smartErrors` | 对应数据源的具体错误 |
| `null` / 空数组 | 结合错误字段判断；不能一律解释为正常、无设备或零用量 |

## pwsh 调用模式

Windows 原生数据通过仓库自带的 `pwsh/pwsh.exe` 采集，使用 `-NoProfile -NonInteractive -ExecutionPolicy Bypass`。命令输出 JSON，Node 负责解析；文本优先按 UTF-8 解码，失败时回退 GBK。超时或解析失败返回结构化错误。

输入先做类型、范围或白名单校验。动态字符串由 [pwsh-data.ts](../../agent/home/extensions/pwsh-data.ts) 编码为数据表达式，避免引号进入脚本语法。sys、driver、startup 通过公共包装保留 PowerShell 非终止错误；eventlog 另按异常类型和错误 ID 分类。

## 提示词

| 注册字段 | 用途 |
|---|---|
| `description` / 参数 schema | 向模型解释工具和参数 |
| `promptSnippet` | 加入系统提示词的工具列表 |
| `promptGuidelines` | 提供工具选择和使用规则 |
| `label` | 仅用于 TUI 显示 |

覆盖内置工具时必须自带 `promptSnippet`，否则可能从工具提示列表中消失。`ls` 使用同名注册覆盖内置版本。

## 维护

`agent/home/extensions` 下的 TypeScript 文件由 pi 加载，默认导出函数负责注册工具。共享模块提供空默认导出，避免被当成无效扩展。跨扩展缓存使用进程级单例，见 [wz-index](wz-index.md)。

格式与检查规则以根目录 [biome.json](../../biome.json) 为准：

```sh
npx @biomejs/biome@2.3.5 check agent/home/extensions
```

修改行为时同步参数、字段和降级说明，并按 [测试指南](../test/README.md) 选择必要的局部验证。`tests/` 下的开发脚本不随 Git 分发。
