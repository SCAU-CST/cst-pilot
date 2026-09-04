---
name: disk
description: disk 工具的参数与返回字段说明。覆盖 scope 枚举含义、参数约束、各 scope 的数据来源、耗时与降级行为、返回字段定义。
---

# disk 工具说明

只读磁盘信息工具。一次调用按 `scope` 参数返回其中一个子功能的结果，不做任何修改。

## 参数

1. `scope`（必填）：`space` / `info` / `health` / `usage` / `all`
2. `drive`（可选）：限定盘符，只接受单个字母（如 `C`），传 `C:` 或完整路径会被拒绝。对 `space` / `info` / `health` 生效，省略则返回全部卷。对 `info` 是双过滤：卷按盘符滤，物理盘按盘符→分区→物理盘关联只留所在盘（关联查询失败时退回全量并在 infoNotice 如实声明）
3. `path`（可选）：`scope=usage` 时必填，要分析的目录或盘符，整个目录树会被统计
4. `top`（可选）：`scope=usage` 时生效，排行条数，默认 20，上限 100

## 各 scope 的数据来源、耗时与返回

1. `space`：Node `statfsSync` 统计各卷，瞬间返回。返回字段：`drive` / `totalGB` / `freeGB` / `usedPct`
2. `info`：pwsh 查询 `Get-PhysicalDisk` 与 `Win32_LogicalDisk`，约 4 秒。`physicalDisks` 含型号 / 序列号 / SSD 或 HDD / NVMe 或 SATA 或 USB / 健康状态；`volumes` 含盘符 / 卷标 / 文件系统 / 盘类型（数字码已译为 Fixed / Removable / Network / Optical）/ 总量 / 剩余
3. `health`：pwsh 查询 `Get-StorageReliabilityCounter`，返回磨损度（Wear）/ 温度 / 通电小时 / 读写错误计数。需要管理员权限；权限不足时返回 `smart: null` 与 `smartNotice` 说明，其余 scope 不受影响
4. `usage`：优先由仓库自带 WizTree 扫描后流式解析（NTFS 卷直读主文件表 MFT 全盘秒级；FAT32/exFAT 卷无 MFT，走目录遍历，结果同样为全量但非 MFT 精确账）；WizTree 不可用或失败时自动降级为逐文件递归统计（慢，大目录可达分钟级，结果为下界）。降级后结果 `method` 为 `node-walk` 并附 `degradedFrom`；快速路径 NTFS 卷 `method` 为 `wiztree-mft`，非 NTFS 卷为 `wiztree-walk` 并在 notice 说明
5. `all`：一次执行 `space` + `info` + `health`，不含 `usage`

## usage 返回字段定义

1. `root`：所查路径；`totalGB`：整树大小（各项 `pct` 均相对它计算）
2. `topDirs`：目录大小排行，含 `pct`
3. `topFiles`：单个大文件排行，含 `pct`
4. `extAgg`：按扩展名聚合，含文件数
5. `staleFiles`：≥50MB 且 ≥1 年未修改的文件，大者优先
6. `sizeGB` 自适应精度：真实数据小到两位小数归零时自动提升位数，不显示假 0

## 通用约定

1. 结果中的 `notice` 字段是降级/附注说明，转达给队员时不能省略
2. WizTree 扫描结果有秒级时效偏差
3. 快速路径的扫描数据会同时写入进程内共享账本（供 `ls` 直接查询）
