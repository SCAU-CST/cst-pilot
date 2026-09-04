# 环境测试：PE 盘环境

对应 Testlist「PE 盘环境」维度。最高风险环境：目标不是"全部通过"，而是**验证每一处不可用都表现为优雅降级（明确 error/notice），绝不崩溃、挂起或静默返回错误数据**。执行结构：① README 全量工具检测组 B01–B31；② 本文档差异项，逐条记录降级形态。

## 建议测试机画像

| PE | 画像 |
|---|---|
| 微PE / FirPE / 优启通 | 任一主流第三方 PE，Win10/Win11 内核 |
| 官方 ADK WinPE | 无注入驱动的基线（最小系统） |

## PE 特有风险（判读前提）

1. WMI 服务（WinMgmt）PE 默认关闭 → sys/driver/eventlog/startup 的 CIM 查询预期大面积失败
2. 事件日志服务关闭 → eventlog 预期整体不可用
3. PE 的 HKLM 是 PE 自身系统，非目标机系统 → startup 结果不指向机主系统，属预期语义
4. 存储/网络 cmdlet 模块可能缺失 → disk info/health 降级

## 差异测试项

| # | 需求 | Agent 调用 | Reviewer pwsh 核查 | 判据 |
|---|---|---|---|---|
| P01 | node 运行时在 PE | pi.cmd 启动 | 独立跑 `node.exe --version` | 启动成功或明确报错，不挂起 |
| P02 | 便携 pwsh 7 在 PE | 任一工具调用 | 独立跑 `pwsh.exe -c $PSVersionTable` | 同上 |
| P03 | WMI 关闭下的 sys | sys `overview` | `Get-CimInstance` 独立验证失败 | 明确 error + 原因，不崩溃 |
| P04 | WMI 关闭下的 driver | driver `problem` | 同上 | 同上 |
| P05 | 事件日志关闭下的 eventlog | eventlog `recent` | `Get-WinEvent` 独立验证失败 | 同上 |
| P06 | startup 的 PE 语义 | startup 全量 | 对照 PE 自身注册表 | 结果来自 PE 系统，如实说明非目标机 |
| P07 | WizTree 在 PE | disk `usage <目标卷>` | `fsutil` / 独立扫描对照 | PE 默认 SYSTEM 权限下 MFT 路径可用性如实 |
| P08 | lhm 在 PE | sys `sensor` | — | 传感器可空，counterErrors 如实 |
| P09 | 账本与写入介质 | disk `usage` 后查 ls | 检查 `<Kit>\agent\home\fff` | PE 只读介质或写保护时不死循环，降级如实 |
| P10 | 裁剪差异 | 三种 PE 互相对照 | — | 记录各 PE 通过/降级矩阵，归纳第三方 PE 共性 |
