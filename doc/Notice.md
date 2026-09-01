# 设计备忘

本项目与常规 pi Agent 用法不同的地方。完整论证分散在各开发文档中，
这里只留一份清单：每条给出结论和权威出处，未指向出处的条目以本文为准。

## AGENTS.md 不会生效

`--no-context-files` 关闭的不只是项目上下文文件，也包括 `agent\home` 下的全局
AGENTS.md（加载逻辑在 `noContextFiles` 时直接返回空列表）。因此 Agent 指令不放在
AGENTS.md，而是放在 `agent\home\APPEND_SYSTEM.md`——pi 内置的追加系统提示词文件，
从 `PI_CODING_AGENT_DIR` 自动发现并附加到默认系统提示词之后，不受该开关影响，
也无需改动 `pi.cmd` 的启动参数。

## 覆盖内置工具会连带顶掉它的提示词片段

自定义 `ls` 覆盖内置工具后，若不自带 `promptSnippet`，`ls` 会从
`Available tools:` 列表消失；`label` 只用于 TUI 显示，不进提示词。
详见 [doc\tool\README.md](tool/README.md)「提示词」。

## 模型上下文与 TUI 渲染使用不同的数据

模型只读 `content[0].text`；`details` 仅用于 TUI 渲染，不进模型上下文，
模型消费的信息必须完整落在 `data / notice / error` 三个约定键里。
详见 [doc\tool\README.md](tool/README.md)「返回结构」。

## pi.cmd 保持纯 ASCII

cmd 按 ANSI/GBK 解析批处理文件，中文内容在部分机器上会导致解析错误。
启动器的说明性内容放在 ASCII 注释中（见 `pi.cmd` 文件头）。

## pwsh 输出解码以 GBK 兜底

`runPwsh()` 对 stdout/stderr 先按 UTF-8 严格解码，失败回退 GBK，
否则中文系统的错误输出（ANSI 代码页）会变成乱码。
详见 [doc\tool\README.md](tool/README.md)「pwsh 调用模式」。

## CPU 核心温度在零安装约束下不可得

读 MSR 需内核驱动，两条驱动路线（WinRing0 被 CVE 拦截、PawnIO 需安装）
都不满足零宿主安装，故用降频信号替代过热诊断。
完整论证与实测记录见 [doc\tool\sys.md](tool/sys.md)「能力边界」。

## 项目信任永久关闭

本工具可能在机主电脑的任意目录启动，cwd 祖先链上可能出现陌生项目的 `.pi\` 资源。
`defaultProjectTrust=never` 保证这些资源不会被加载，属于隔离设计的一部分而非可选项。
