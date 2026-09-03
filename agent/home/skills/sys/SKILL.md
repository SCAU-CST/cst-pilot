---
name: sys
description: sys 工具的参数与返回字段说明。覆盖 scope 枚举含义、参数定义、五个 scope 的数据来源、采样方式、耗时与字段语义、CPU 核心温度不可得的原因。
---

# sys 工具说明

只读系统检查工具，按 `scope` 参数返回运行时状态，不做任何修改。不传 `scope` 时默认 `overview`。五个 scope 均免管理员。

## 参数

1. `scope`（可选）：`overview` / `proc` / `gpu` / `sensor` / `io`，不传默认 `overview`
2. `top`（可选）：Top N 条数，默认 10，上限 50，仅对 `proc` / `gpu` / `io` 生效

## scope=overview：整机负载快照

1. 数据来源：CPU 总占用率取 `Win32_PerfFormattedData_PerfOS_Processor`（格式化计数器类，读两次取第二次，类名不随系统语言本地化）；内存取 `Win32_OperatingSystem`；页面文件取 `Win32_PageFileUsage`；内核内存池取 `Win32_PerfFormattedData_PerfOS_Memory`；机型取 `Win32_ComputerSystem` / `Win32_BIOS` / `Win32_Processor`；开机时长取 `LastBootUpTime` 与当前时间差
2. 字段：`cpuTotalPct`（近 1 秒差分值）/ `logicalCores` / `mem`（totalMB / usedMB / freeMB / usedPct）/ `pagefile`（allocMB / usedMB / peakMB）/ `pool`（nonpagedMB / pagedMB）/ `machine`（vendor / model / cpu / physicalCores / bios / biosDate）/ `uptime`（bootTime / text / totalHours）
3. 字段语义与判读：内存高但 proc.byMem 对不上大户 → 看 `pool.nonpagedMB`（不可换出的内核内存，持续异常增长 = 驱动泄漏）；现场按 `machine.vendor + model` 匹配机型已知问题（散热缺陷、OEM 预装坑），这是品牌机维修的第一步；`machine.bios` 过旧可能关联兼容性问题

## scope=proc：进程盘点

1. 数据来源：pwsh 单命令内 1.2 秒双采样差分——两次 `Get-Process` 取 `TotalProcessorTime`，按 Stopwatch 计的实际间隔与逻辑核数折算
2. 字段：`byCpu`（CPU 占用率 Top N）/ `byMem`（内存 Top N）；每项含 `name` / `pid` / `wsMB` / `cpuPct` / `path`
3. 字段语义：`wsMB` 是工作集（与任务管理器默认的内存列一致）；`cpuPct` 是采样窗口内的平均值，瞬时突发会低估；单进程吃满全部逻辑核时显示 100%；`path` 是可执行文件路径，系统进程或权限不足时为 null，可用于就地验证进程身份（与 startup 的自启项交叉核对）

## scope=gpu：GPU 状态

1. 数据来源：`GPU Engine` 与 `GPU Process Memory` 性能计数器按 pid 聚合（这两个计数器组在中文 Windows 上英文名可用，未被本地化；偶发无效采样会自动重试 1 次）；适配器清单取 `Win32_VideoController`；检测到 `nvidia-smi`（系统驱动自带）时并行附带显卡状态
2. 字段：`byGpuPct`（每进程 GPU 利用率 Top N，`engtypes` 为该进程用到的引擎类型清单，如 3d / copy / videodecode / videoencode）/ `byDedicatedMB`（每进程专用显存 Top N）/ `adapters`（显卡适配器清单：name / vendor / driver / status / bus）/ `nvidia`（温度 / 功耗 / 显存 / 利用率 / 驱动版本，无 NVIDIA 显卡时为 null）/ `engineSamples`（聚合前原始实例数）/ `lhmGpu`（仅无 NVIDIA 时出现，LHM 用户态读的核显 / 其他卡原始传感器）
3. 字段语义：`gpuPct` 是瞬时采样；`nvidia: null` 只说明未检出 NVIDIA 独显，不代表没有显卡；`adapters.bus` = PCI 为实体卡插槽设备，ROOT / USB 等多为虚拟显示 / 采集卡，真实显卡以 vendor 为硬件厂商的那条为准；`lhmGpu.hardware` 为空 = 本机无可读 GPU 传感器（部分老核显 LHM 不支持），此时每进程利用率 `byGpuPct` 仍可用

## scope=io：磁盘 IO 定位

1. 适用：「电脑卡但 CPU / 内存都闲」——最常见原因是磁盘 IO 打满。一条 pwsh 命令内两路数据共用同一采样窗口（Stopwatch 计真实间隔）：每进程 IO 取 `Win32_Process` 的 `Read/WriteTransferCount` 两次快照差分（进程启动以来累计值，不走 PerfProc 慢路径）；每盘取 `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` 格式化计数器类双读（首读丢弃）
2. 字段：`disks`（每物理盘：`disk` / `queueLen` 队列深度 / `busyPct` 忙碌百分比 / `readKBs` / `writeKBs`，按忙碌度降序）/ `byIo`（每进程读+写 IO 速率 Top N：`name` / `pid` / `ioKBs`）/ `intervalSec` / `totalProcs`
3. 字段语义与判读：`busyPct` 持续 >80 或 `queueLen` 持续 >1 = IO 瓶颈，byIo 榜首即嫌疑人；机械盘 busyPct 长期接近 100% 而吞吐不高，指向碎片或坏盘前兆（交叉 disk 的 SMART）；byIo 只列窗口内有 IO 活动的进程，全部空闲时为空数组（合法数据）；首次调用含磁盘计数器预热（冷约 10 秒，热后约 3 秒）

## scope=sensor：温度 / 风扇 / 电压 / 降频

1. 数据来源（一条 pwsh 命令内顺序取三路）：LibreHardwareMonitorLib 用户态读取（DLL 随仓库 `lhm\` 分发，GPU 类传感器免管理员）；`Thermal Zone Information` 性能计数器（热区温度，开尔文已转摄氏度）；`Processor Information` 的 `% of Maximum Frequency` 计数器
2. 字段：`sensors`（hw / name / type / value，type 为 Temperature / Fan / Voltage）/ `thermalZones`（zone / tempC / passivePct）/ `frequency`（cores / minPctOfMax / avgPctOfMax）/ `admin` / `pawnio` / `hardware`（检测到的硬件名）/ `counterErrors`（仅计数器读取失败时出现：thermal / frequency 附原因）
3. 字段语义：`passivePct` < 100 表示该热区正在被动降热；`minPctOfMax` 是各核当前频率占最大频率的最低百分比——过热降频与省电降频都表现为低值，该值需结合 CPU 负载解读；`counterErrors` 出现时，对应字段为空是读取失败，不代表机器没有热区 / 降频计数器
4. 能力边界：CPU 核心温度不可得。读 MSR 需要内核驱动，LHM 旧版内置的 WinRing0 属漏洞驱动（CVE-2020-14979）被微软拦截，新版改用的 PawnIO 需在目标机安装驱动，均不满足零宿主安装约束；已装入 PawnIO 且管理员运行时 CPU / 主板传感器会出现在 `sensors` 中（`notice` 会说明）

## 通用约定

1. 结果中的 `notice` 字段是降级/附注说明，转达给队员时不能省略
2. `error` 字段表示该路数据取数失败并附原因，如实转达
