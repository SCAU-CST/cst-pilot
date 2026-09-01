# 自定义工具开发者文档

cst-pilot 自研的四个扩展实现。供维护者阅读：设计背景、实现细节、取舍依据。

| 文档 | 对应实现 | 一句话 |
|---|---|---|
| [ls.md](ls.md) | `ls.ts` | 目录浏览工具，覆盖 pi 内置 ls |
| [disk.md](disk.md) | `disk.ts` | 存储分析：空间 / 信息 / 健康 / 占用 |
| [sys.md](sys.md) | `sys.ts` | 系统检查：进程 / GPU |
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

自研工具对外只注册一个工具名（如 `disk`、`sys`），内部的子功能用
`scope` 参数区分：调用时传 `scope="usage"` 就是查占用排行，
传 `scope="health"` 就是查 SMART。它相当于同一个工具里的子命令。

这样做的收益：工具描述只占一份上下文，模型学会一次就能用全部子功能；
子功能之间共享 pwsh 调用、超时、降级等基础设施。

### LLM 实际收到的提示词：三个通道

工具注册后，LLM 从三个通道感知这个工具（均经运行时实测验证，
抓取脚本 `_t5.mjs`）：

| 通道 | 来源 | 位置 |
|---|---|---|
| `Available tools:` 列表行 | `promptSnippet`（一行短话） | 系统提示词 |
| `Guidelines:` 条目 | `promptGuidelines`（数组，逐条列出，去重） | 系统提示词 |
| Function schema | `description` + `parameters`（TypeBox 转 JSON Schema，含 enum/required） | 每次 API 请求的 tools 数组 |

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

### 测试与文档实例

`agent\_t1.mjs` ~ `_t4.mjs`：用 `createAgentSession` 起隔离会话，
从 `agent.state.tools` 直接取工具对象调 `execute()`，绕过 LLM 验证工具层。

`_t4.mjs` 是文档实例抓取脚本：各工具文档中的调用/输出实例均为其真实运行结果，
而非手写示意。改了工具实现后重跑即可更新文档实例。
