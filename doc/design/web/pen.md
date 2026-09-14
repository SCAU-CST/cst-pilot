# Pen 操作建议

本文档记录MCP和SKILLS之外的操作建议。

## 建议

1. 首选pen cli的操作方式

## 来源

1. `pen --help`：CLI 顶层命令、参数与示例。
2. `pen interactive --help`：全部 MCP 工具、参数、调用示例。
3. `pen version`、`pen status`：CLI 版本与登录状态。
4. MCP `pencil_read_skill`：应用内置 skill，含 schema、`execute` API、组件与样式。同一份在 Pen 安装目录的 `resources\app.asar.unpacked\out\skills\pen-dev\`。
5. MCP `pencil_execute` 的 schema：`mcp({ describe: "pencil_execute" })`。
6. `~/.pencil/skills/`：应用下载的设计技能包，排版与动效指导。
7. <https://docs.pen.dev>：官方文档首页。
8. <https://docs.pen.dev/for-developers/the-pen-format>：`.pen` 格式与 schema。
9. <https://docs.pen.dev/for-developers/pen-cli>：CLI 命令、交互模式、批量任务。
10. <https://docs.pen.dev/core-concepts/keyboard-shortcuts>：快捷键，含 `Ctrl+S` 保存、`Ctrl+O` 打开。
11. <https://docs.pen.dev/troubleshooting>：已知限制，含「没有自动保存」。
12. <https://docs.pen.dev/core-concepts/design-libraries>：设计库。
13. <https://docs.pen.dev/core-concepts/components>：组件与实例。
14. `%APPDATA%\Pen\logs\main.log`：应用运行日志，排查 MCP 连接与保存行为。
