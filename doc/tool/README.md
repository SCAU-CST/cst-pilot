# 自定义工具开发者文档

cst-pilot 自研的五个扩展实现。供维护者阅读：设计背景、实现细节、取舍依据。

| 文档 | 对应实现 | 一句话 |
|---|---|---|
| [ls.md](ls.md) | `ls.ts` | 目录浏览工具，覆盖 pi 内置 ls |
| [disk.md](disk.md) | `disk.ts` | 存储分析：空间 / 信息 / 健康 / 占用 |
| [sys.md](sys.md) | `sys.ts` | 系统检查：整机概况 / 进程 / GPU / 传感器 |
| [startup.md](startup.md) | `startup.ts` | 开机自启盘点：注册表 / 启动文件夹 / 自启服务（独立工具，非 sys scope） |
| [wz-index.md](wz-index.md) | `wz-index.ts` | 跨扩展共享的 WizTree 大小账本（非工具，共享模块） |

## 共性约定

所有自研工具遵守同一套约定，读单个文档前先看这里。

### 只读原则

- 不写注册表、不改系统配置
- 唯一写路径：`wiztree\tmp` 下的临时 CSV，用完即删
- 模型输入只做白名单校验后插值，命令串写死在代码里

### pwsh 调用模式

需要 Windows 原生数据的工具统一走 `runPwsh()`：

- 调仓库自带 `pwsh\pwsh.exe`，`-NoProfile -NonInteractive -ExecutionPolicy Bypass`
- 输出强制 JSON（pwsh 侧 `ConvertTo-Json`），Node 侧 `JSON.parse`
- stdout/stderr 按 Buffer 接收，UTF-8 严格解码失败回退 GBK（中文系统错误输出是 ANSI 代码页）
- 超时收敛为 `{ error }`，不抛异常

### 返回结构

`{ content: [{ type: "text", text: JSON.stringify(result) }], details: result }`。
result 内约定三个键：`data` 本体、`notice` 降级/附注说明、`error` 失败原因。
模型学会一次，所有工具通用。

### scope：一个工具，多个子功能

自研的多功能工具对外只注册一个工具名（如 `disk`、`sys`），内部的
子功能用 `scope` 参数区分：调用时传 `scope="usage"` 就是查占用排行，
传 `scope="health"` 就是查 SMART。它相当于同一个工具里的子命令。

scope 适合**同质子功能的聚合**（都是实时负载/存储采集，共享采集设施）。
性质不同的能力应独立注册：`startup`（配置盘点）原本规划为 sys 的
`startup` scope，落地前剥离为独立工具——它与实时负载不属一类问题，
无共享采集逻辑，塞进 scope 只会让 sys 描述变长、边界变模糊
（决策记录见 sys_design.md 待拍板）。

这样做的收益：工具描述只占一份上下文，模型学会一次就能用全部子功能；
子功能之间共享 pwsh 调用、超时、降级等基础设施。

### 提示词

两个容易踩的坑：

- **覆盖内置工具会顶掉内置 snippet**：自定义 `ls` 覆盖内置后，
  若不写自己的 `promptSnippet`，`ls` 会从 `Available tools:` 列表消失
  （初版曾中招，已修）。列表只收 snippet 非空的工具。
- **`label` 只用于 TUI 显示，不进任何提示词**。

另外，模型看到的**工具结果** = 返回值 `content[0].text`（JSON 字符串）；
`details` 只用于 TUI 渲染，不进模型上下文。

### 注册机制

`extensions\` 下的 `.ts` 由 pi 自动加载，default export 接收 `pi`，调 `pi.registerTool()` 注册。
共享模块（如 wz-index.ts）提供一个空 factory 让加载器安静。
同名注册覆盖内置工具（ls 即用此机制）。
