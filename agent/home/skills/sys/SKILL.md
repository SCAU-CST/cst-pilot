---
name: sys
description: sys 工具的参数与返回字段说明。覆盖 scope 枚举含义、参数定义、四个 scope 的数据来源、采样方式、耗时与字段语义、CPU 核心温度不可得的原因。
---

# sys 工具说明

只读系统检查工具，按 `scope` 参数返回运行时状态，不做任何修改。不传 `scope` 时默认 `overview`。四个 scope 均免管理员。

## 参数

1. `scope`（可选）：`overview` / `proc` / `gpu` / `sensor`，不传默认 `overview`
2. `top`（可选）：Top N 条数，默认 10，上限 50，仅对 `proc` / `gpu` 生效

## scope=overview：整机负载快照

1. 数据来源：CPU 总占用率取 `Win32_PerfFormattedData_PerfOS_Processor`（格式化计数器类，读两次取第二次，类名不随系统语言本地化）；内存取 `Win32_OperatingSystem`；页面文件取 `Win32_PageFileUsage`；开机时长取 `LastBootUpTime` 与当前时间差
2. 字段：`cpuTotalPct`（近 1 秒差分值）/ `logicalCores` / `mem`（totalMB / usedMB / freeMB / usedPct）/ `pagefile`（allocMB / usedMB / peakMB）/ `uptime`（bootTime / text / totalHours）

## scope=proc：进程盘点

1. 数据来源：pwsh 单命令内 1.2 秒双采样差分——两次 `Get-Process` 取 `TotalProcessorTime`，按 Stopwatch 计的实际间隔与逻辑核数折算
2. 字段：`byCpu`（CPU 占用率 Top N）/ `byMem`（内存 Top N）；每项含 `name` / `pid` / `wsMB` / `cpuPct`
3. 字段语义：`wsMB` 是工作集（与任务管理器默认的内存列一致）；`cpuPct` 是采样窗口内的平均值，瞬时突发会低估；单进程吃满全部逻辑核时显示 100%

## scope=gpu：GPU 状态

1. 数据来源：`GPU Engine` 与 `GPU Process Memory` 性能计数器按 pid 聚合（这两个计数器组在中文 Windows 上英文名可用，未被本地化）；检测到 `nvidia-smi`（系统驱动自带）时并行附带显卡状态
2. 字段：`byGpuPct`（每进程 GPU 利用率 Top N，`engtypes` 为该进程用到的引擎类型清单，如 3d / copy / videodecode / videoencode）/ `byDedicatedMB`（每进程专用显存 Top N）/ `nvidia`（温度 / 功耗 / 显存 / 利用率 / 驱动版本，无 NVIDIA 显卡时为 null）/ `engineSamples`（聚合前原始实例数）
3. 字段语义：`gpuPct` 是瞬时采样

## scope=sensor：温度 / 风扇 / 电压 / 降频

1. 数据来源（一条 pwsh 命令内顺序取三路）：LibreHardwareMonitorLib 用户态读取（DLL 随仓库 `lhm\` 分发，GPU 类传感器免管理员）；`Thermal Zone Information` 性能计数器（热区温度，开尔文已转摄氏度）；`Processor Information` 的 `% of Maximum Frequency` 计数器
2. 字段：`sensors`（hw / name / type / value，type 为 Temperature / Fan / Voltage）/ `thermalZones`（zone / tempC / passivePct）/ `frequency`（cores / minPctOfMax / avgPctOfMax）/ `admin` / `pawnio` / `hardware`（检测到的硬件名）
3. 字段语义：`passivePct` < 100 表示该热区正在被动降热；`minPctOfMax` 是各核当前频率占最大频率的最低百分比——过热降频与省电降频都表现为低值，该值需结合 CPU 负载解读
4. 能力边界：CPU 核心温度不可得。读 MSR 需要内核驱动，LHM 旧版内置的 WinRing0 属漏洞驱动（CVE-2020-14979）被微软拦截，新版改用的 PawnIO 需在目标机安装驱动，均不满足零宿主安装约束；已装入 PawnIO 且管理员运行时 CPU / 主板传感器会出现在 `sensors` 中（`notice` 会说明）

## 通用约定

1. 结果中的 `notice` 字段是降级/附注说明，转达给队员时不能省略
2. `error` 字段表示该路数据取数失败并附原因，如实转达
