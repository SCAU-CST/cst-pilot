# 环境测试：移动介质

对应 Testlist「移动介质」维度（装本项目的介质）。执行结构：① README 全量工具检测组 B01–B31；② 本文档差异项。核心风险：低速介质耗时放大、非 NTFS 文件系统的 method 标注与单文件上限。

## 建议测试机画像

| 介质 | 画像 |
|---|---|
| USB 2.0 U 盘 | 低速基线（约 30MB/s 上限） |
| USB 3.0/3.2 U 盘 / PSSD | 主流与高速基线 |
| 移动机械硬盘 | USB 3.0 桥接，随机读写差 |
| SD 卡 + 读卡器 | 桥接枚举 + 可能 exFAT |

文件系统三态（FAT32 / exFAT / NTFS）至少各测一种介质。

## 差异测试项

| # | 需求 | Agent 调用 | Reviewer pwsh 核查 | 判据 |
|---|---|---|---|---|
| M01 | 低速介质建账耗时 | disk `usage <Kit>` 冷调 | `Measure-Command` 独立计时 | USB2 建账耗时如实放大，不熔断则完整 |
| M02 | exFAT：method 标注 | disk `usage` / ls | `Get-Volume` 确认 exFAT | 非 NTFS 卷 method 标注与实际路径一致（ FAT32 缺陷是否同样存在） |
| M03 | NTFS U 盘：MFT 直读 | disk `usage` | `fsutil fsinfo ntfsinfo`（如可用） | 可移动 NTFS 卷 MFT 路径是否可用；权限降级如实 |
| M04 | 单文件上限场景 | disk `usage top`（含 ≥4GB 文件时） | 文件字节数对照 | FAT32 无 ≥4GB 文件为正常；有则 topFiles 数值正确 |
| M05 | 机械盘遍历特征 | disk `usage`（机械盘目标） | 独立计时 | 随机读慢的量级如实，降级 notice 不缺 |
| M06 | 账本失效语义 | 拔插介质后再 ls 同路径 | — | 账本重建或如实提示，不返回陈旧数据 |
| M07 | SD 卡枚举 | disk `info`（读卡器） | `Get-Disk BusType` | 桥接识别为 USB，卷文件系统如实 |
| M08 | pi 端到端启动 | 计时 `pi.cmd` 到就绪 | 秒表独立计时 | 各介质启动耗时差距如实记录 |
