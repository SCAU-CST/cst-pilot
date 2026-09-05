# 工具文档

本目录说明六个只读诊断工具的调用方式、返回字段和限制。设计理由见 [design](../design/sys_design.md)，验证方法见 [测试指南](../test/README.md)。

| 要解决的问题 | 工具 | 实现 |
|---|---|---|
| 目录里谁占空间 | [ls](ls.md) | [ls.ts](../../agent/home/extensions/diagnostics/ls.ts) |
| 磁盘容量、型号、健康与占用 | [disk](disk.md) | [disk.ts](../../agent/home/extensions/diagnostics/disk.ts) |
| CPU、内存、GPU、IO 与传感器 | [sys](sys.md) | [sys.ts](../../agent/home/extensions/diagnostics/sys.ts) |
| 开机会启动什么 | [startup](startup.md) | [startup.ts](../../agent/home/extensions/diagnostics/startup.ts) |
| 崩溃、蓝屏、服务与登录历史 | [eventlog](eventlog.md) | [eventlog-core.ts](../../agent/home/extensions/diagnostics/eventlog-core.ts) |
| 设备识别与驱动状态 | [driver](driver.md) | [driver-core.ts](../../agent/home/extensions/diagnostics/driver-core.ts) |
| 维护共享目录大小缓存 | [wz-index](wz-index.md)（内部模块） | [wz-index.ts](../../agent/home/extensions/diagnostics/wz-index.ts) |

## 使用约定

- 支持范围为 Windows 10/11 x64；裁剪系统、PE 和特殊介质的可用性需单独验证。
- 工具不改注册表、设备状态或系统配置。存储扫描会在 `wiztree/tmp` 写入临时 CSV，并在结束时尝试清理；目录大小缓存保存在进程内。
- 文档中的 `工具名({...})` 是工具调用示意，不是可直接粘贴到 PowerShell 的命令。
- 多功能工具用 `scope` 选择子功能；`ls`、`startup` 不使用 scope。各工具的必填参数见对应页面。
- 示例数值仅用于说明字段，不能作为其他机器的通过标准。

## 返回结构

模型读取 `content` 中的 JSON 文本。所有工具同时返回 `details` 供 TUI 渲染。需要模型获知的信息必须出现在文本中。

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

整次查询无法完成时，execute 抛错，由 pi 标记 `isError`；失败原因仍写入给模型的错误文本。可用数据伴随部分数据源失败时，保留成功结果及 `degraded`、`notice` 等说明，不将正常空清单当成失败。

模型 JSON 输出最多 50 KiB。超限时先裁剪列表和字符串，再序列化，保留合法 JSON；`outputTruncated`、`originalBytes` 和 `outputNotice` 说明本次裁剪。统计总数仍对应原查询，需缩小查询范围获取省略内容。完整采集结果保存在 details，仅用于渲染，不自动落盘。

## pwsh 调用模式

Windows 原生数据通过仓库自带的 `pwsh/pwsh.exe` 采集，使用 `-NoProfile -NonInteractive -ExecutionPolicy Bypass`。命令输出 JSON，Node 负责解析；文本优先按 UTF-8 解码，失败时回退 GBK。超时或解析失败返回结构化错误。

输入先做类型、范围或白名单校验。动态字符串由 [pwsh-data.ts](../../agent/home/extensions/diagnostics/pwsh-data.ts) 编码为数据表达式，避免引号进入脚本语法。sys、driver、startup 通过公共包装保留 PowerShell 非终止错误；eventlog 另按异常类型和错误 ID 分类。

## 提示词

| 注册字段 | 用途 |
|---|---|
| `description` / 参数 schema | 向模型解释工具和参数 |
| `promptSnippet` | 加入系统提示词的工具列表 |
| `promptGuidelines` | 提供工具选择和使用规则 |
| `label` | 仅用于 TUI 显示 |

覆盖内置工具时必须自带 `promptSnippet`，否则可能从工具提示列表中消失。`ls` 使用同名注册覆盖内置版本。

## 维护

`agent/home/extensions/diagnostics/index.ts` 是唯一扩展入口，按 pi 的多文件扩展约定注册六个工具。辅助模块只导出实际使用的函数和类型。入口创建共享目录索引并传给 disk、ls，每次重新加载入口都会建立新状态，见 [wz-index](wz-index.md)。

- `disk.ts`、`driver.ts`、`eventlog.ts`：工具注册和参数 schema；对应 core 文件负责采集与路由。
- `sys.ts`：工具注册与采集；`sys-commands.ts`：PowerShell 查询模板。
- `startup.ts`、`ls.ts`：较小的独立工具模块。
- `runtime.ts`：便携程序路径、子进程、解码与 JSON 边界；`pwsh-data.ts`：PowerShell 数据表达式和采集包装。
- `result.ts`：模型输出体积限制与整次失败上报；`driver-data.ts`：设备结果 schema 和运行时校验。

扩展采用 `ExtensionAPI` 和 schema 推导参数。取消信号由 execute 逐层传入子进程及目录遍历；相对路径以 pi 的 `ctx.cwd` 为基准。开发检查参考 pi 0.84.4 的 API，使用严格类型检查与仅可擦除的 TypeScript 语法，不引入构建步骤。

格式与检查规则以根目录 [biome.json](../../biome.json) 为准：

```sh
cd agent
npm run check
# 仅应用格式与安全修复：npm run format
# 仅类型检查：npm run typecheck
```

开发依赖锁定 Biome 2.3.5、TypeScript 5.9.3；首次准备开发环境可在 agent 目录执行 `npm install --ignore-scripts`。typebox 和 pi-ai 由 pi 的扩展加载器提供，tsconfig paths 对应当前安装包的类型位置。检查命令不运行诊断工具。修改输出语义时同步工具说明。
