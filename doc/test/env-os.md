# 环境测试：操作系统世代

对应 Testlist「操作系统」维度。执行结构：① README 全量工具检测组 B01–B31；② 本文档差异项。核心风险：老版本 cmdlet 缺失、政采裁剪、安全软件注入。

## 建议测试机画像

| OS | 画像 |
|---|---|
| Win10 各版本（1507~22H2） | 老旧笔记本/台式机，世代越低越好 |
| Win10 政府专用版 | 政采机器，预装天擎等安全软件，接税务 UKey / CA Key / 国密卡 |

## 差异测试项

| # | 需求 | Agent 调用 | Reviewer pwsh 核查 | 判据 |
|---|---|---|---|---|
| O01 | 便携 pwsh 7 启动 | 任一工具调用（隐式） | `$PSVersionTable` | 便携 pwsh 不依赖系统 PowerShell |
| O02 | 存储层 cmdlet 兼容 | disk `info` / `health` | `Get-PhysicalDisk` 存在性 | 老版本缺 cmdlet 时走 CIM 备路或如实 error |
| O03 | 性能计数器本地化 | sys `overview` / `io` | `Get-Counter` 英文路径可用 | 计数器类名英文不随系统语言本地化 |
| O04 | 中文消息渲染 | eventlog `recent` | `Get-WinEvent` 同源消息 | msg 中文、levelName 固定英文 |
| O05 | 政采：无云服务 | 基线组全跑 | 服务清单对照 | 无外部依赖报错（工具全本地） |
| O06 | 政采：安全软件注入 | driver `problem` + `find name=天擎等` | `Win32_PnPEntity` 厂商过滤 | 安全软件虚拟设备如实列出，不误判为异常 |
| O07 | 政采：UKey/CA Key 外设 | driver `external`（插入 UKey） | `Win32_USBHub` VID/PID 对照 | USB 设备枚举与 find VID 查询一致 |
| O08 | 政采：事件通道完整性 | eventlog `recent` | 通道清单 `Get-EventLog -List` | System/Application 存在；裁剪通道缺失时如实 error |
