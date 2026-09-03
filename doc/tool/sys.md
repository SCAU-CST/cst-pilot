# sys — 系统检查工具（R1–R4 + 覆盖面复盘）

实现：`agent\home\extensions\sys.ts`。需求见 `doc\PRD.md`，设计见 `doc\design\sys_design.md`。

## 背景

ls/disk 覆盖的是静态存储。维修现场另一半问题——"谁在吃内存、
CPU 是否跑满、GPU 忙不忙、温度是否异常"——属于**运行时状态**，
此前无工具可答。

R1（进程盘点）、R2（GPU 状态）、R3（传感器）、R4（整机概况）是 sys
已实现的前四个 scope。此后按覆盖面复盘（`doc\Todo.md` 2026-09-03）
补齐七项：`io`（磁盘瓶颈定位）、gpu 核显降级与适配器清单、proc
可执行路径、overview 内存池与机型信息、计数器重试。scope 即工具内
的子功能开关：`sys` 只注册一个工具名，调用时用 `scope` 参数选择查
整机、查进程、查磁盘 IO、查 GPU 还是查传感器（架构选型见
sys_design.md）。

## 调用方式

| 参数 | 必填 | 说明 |
|---|---|---|
| `scope` | 否 | `overview`=整机概况（默认）；`proc`=进程盘点；`io`=磁盘 IO 定位；`gpu`=GPU 状态；`sensor`=温度/风扇/电压（R5 自启盘点不在 sys 内，独立工具 startup） |
| `top` | 否 | Top N，默认 10，上限 50，仅 proc/gpu/io 有效 |


## LLM 收到的提示词

系统提示词 `Available tools:` 列表中的行：

```
- sys: Query overall system load, running processes, GPU load, and hardware sensors (read-only)
```

系统提示词 `Guidelines:` 中的条目：

```
- Use sys scope=overview (or omit scope) when the user asks whether the machine is loaded/ sluggish overall: gives RAM usage, total CPU load, pagefile pressure, kernel memory pool, machine model (vendor/model/CPU/BIOS), and uptime in one snapshot.
- Use sys scope=proc when the user asks who is using memory/CPU or whether a process is hogging resources.
- Use sys scope=io when the machine feels slow but CPU and memory look idle: shows per-disk busy/queue/read-write throughput and which processes are doing disk IO.
- Use sys scope=gpu when the user asks about GPU load, VRAM usage, GPU temperature, or which graphics card the machine has (adapters list shows real and virtual display adapters).
- Use sys scope=sensor when the user asks about temperatures, fans, voltages, or overheating (provides GPU sensors, thermal zones, and CPU throttling percentage; CPU core temps need a kernel driver and are unavailable).
```

Function schema（每次请求的 tools 数组中）：

```jsonc
{
  "name": "sys",
  "description": "只读系统检查工具，按 scope 选择子功能（不传默认 overview）：overview=整机负载快照（内存/CPU/页面文件/内存池/机型/开机时长）；proc=进程内存与 CPU 占用 Top N（含可执行文件路径）；io=每盘队列/吞吐 + 每进程 IO 速率 Top N（磁盘瓶颈定位）；gpu=每进程 GPU 利用率与显存排行（附适配器清单；有 NVIDIA 时附显卡状态，无 NVIDIA 时附核显/其他卡传感器）；sensor=温度/风扇/电压/降频信号（过热诊断）。详细指南与诊断交叉印证链见 skill「sys」。",
  "parameters": {
    "type": "object",
    "properties": {
      "scope": { "type": "string", "enum": ["overview", "proc", "gpu", "sensor", "io"] },
      "top":   { "type": "number", "description": "可选，Top N 进程数，默认 10，上限 50。" }
    }
  }
}
```

## scope=overview：电脑现在怎么样（整机负载概况）

```
sys({ scope: "overview" })   // 不传 scope 时兜底此项
```

```jsonc
{
  "overview": {
    "cpuTotalPct": 8,                   // 整机 CPU 占用率（近 1 秒差分）
    "logicalCores": 16,
    "mem": {
      "totalMB": 32557, "usedMB": 21285, "freeMB": 11272,
      "usedPct": 65.4
    },
    "pagefile": [                       // 页面文件（可多个）
      { "name": "C:\\pagefile.sys", "allocMB": 10240, "usedMB": 202, "peakMB": 251 }
    ],
    "pool": {                           // 内核内存池（驱动泄漏定位）
      "nonpagedMB": 1388,               // 不可换出；持续异常增长多为驱动泄漏
      "pagedMB": 777
    },
    "machine": {                        // 机型（品牌机决定已知问题清单，实测本机）
      "vendor": "Maxsun", "model": "Default string",
      "cpu": "12th Gen Intel(R) Core(TM) i5-12600KF", "physicalCores": 10,
      "bios": "American Megatrends International, LLC. H7.4G",
      "biosDate": "2025-02-23"
    },
    "uptime": {
      "bootTime": "2026-09-01 10:36",   // 开机时间
      "text": "11小时11分",              // 人类可读时长，可直接转述
      "totalHours": 11.2
    },
    "notice": "整机负载快照。mem=物理内存用量（usedPct>90 提示内存吃紧…）…"
  }
}
```

实测热调用约 4 秒（含 1 秒 CPU 差分窗口；本进程首次调用额外有 WMI
预热，可达 10 秒）。免管理员。

pool 与 machine 的判读：内存高但 proc.byMem 对不上大户 → 看
`pool.nonpagedMB`（不可换出的内核内存，持续异常增长 = 驱动泄漏）；
现场按 `machine.vendor + model` 匹配机型已知问题（散热缺陷、
OEM 预装坑），这是品牌机维修的第一步。

## scope=proc：谁在吃内存和 CPU

```
sys({ scope: "proc", top: 3 })
```

```jsonc
{
  "proc": {
    "cores": 16,
    "totalProcs": 276,
    "intervalSec": 1.44,                // 实际采样间隔（Stopwatch 计时）
    "byCpu": [                          // CPU 占用率 Top N
      { "name": "com.docker.backend", "pid": 24320, "wsMB": 126, "cpuPct": 5.4,
        "path": "C:\\Program Files\\Docker\\Docker\\resources\\com.docker.backend.exe" },
      { "name": "node",  "pid": 19004, "wsMB": 393, "cpuPct": 0.8, "path": "C:\\Program Files\\nodejs\\node.exe" },
      { "name": "node",  "pid": 22276, "wsMB": 324, "cpuPct": 0.7, "path": "C:\\Program Files\\nodejs\\node.exe" }
    ],
    "byMem": [                          // 内存（工作集）Top N
      { "name": "node",   "pid": 10224, "wsMB": 1425, "cpuPct": 0, "path": "C:\\Program Files\\nodejs\\node.exe" },
      { "name": "Weixin", "pid": 22456, "wsMB": 528,  "cpuPct": 0.1, "path": null },
      { "name": "node",   "pid": 19004, "wsMB": 393,  "cpuPct": 0.8, "path": "C:\\Program Files\\nodejs\\node.exe" }
    ],
    "notice": "进程 276 个，采样间隔 1.44s（16 逻辑核）。byCpu=CPU 占用率 Top N；byMem=内存（工作集）Top N。cpuPct 为采样窗口内的平均值，瞬时突发可能低估。path=可执行文件路径（系统进程或权限不足时为 null，可用于就地验证进程身份）。"
  }
}
```

实测 1.8 秒返回。

## scope=gpu：谁在用显卡、显存还剩多少

```
sys({ scope: "gpu", top: 3 })
```

```jsonc
{
  "gpu": {
    "engineSamples": 452,               // 原始引擎实例数（聚合前）
    "byGpuPct": [                       // GPU 利用率 Top N
      {
        "pid": 1140, "name": "dwm", "gpuPct": 1.2,
        "engtypes": "3d+copy+jpeg+ofa+security+videodecode+videoencode+vr"
        //                      ↑ 该进程用到的引擎类型，可判断它在用 GPU 干什么
      },
      { "pid": 8316,  "name": "wallpaper32",    "gpuPct": 0.4, "engtypes": "3d+copy+…" },
      { "pid": 25576, "name": "WindowsTerminal","gpuPct": 0.4, "engtypes": "3d+copy+…" }
    ],
    "byDedicatedMB": [                  // 专用显存 Top N
      { "pid": 28512, "name": "vmwp",           "dedicatedMB": 3462 },  // Hyper-V 虚拟机
      { "pid": 1140,  "name": "dwm",            "dedicatedMB": 2827 },
      { "pid": 18492, "name": "msedgewebview2", "dedicatedMB": 484 }
    ],
    "adapters": [                       // 显卡适配器清单（含虚拟显示，实测本机）
      { "name": "GameViewer Virtual Display Adapter", "vendor": "GameViewer", "driver": "15.6.5.199", "status": "OK", "bus": "ROOT" },
      { "name": "NVIDIA GeForce RTX 5070 Ti", "vendor": "NVIDIA", "driver": "32.0.15.9186", "status": "OK", "bus": "PCI" }
      // bus=PCI 为实体卡插槽设备（PNPDeviceID 以 PCI\ 开头）；ROOT/USB 等多为虚拟显示、采集卡、USB 显卡
    ],
    "nvidia": {                         // nvidia-smi 附带；无 NVIDIA 显卡时为 null
      "name": "NVIDIA GeForce RTX 5070 Ti",
      "tempC": 51, "powerW": 33.5,
      "vramUsedMB": 7490, "vramTotalMB": 16303,
      "utilPct": 4, "driver": "591.86"
    },
    "notice": "GPU Engine 452 个实例按进程聚合。byGpuPct=GPU 利用率 Top N（engtypes=所用引擎类型…）；byDedicatedMB=专用显存 Top N；adapters=显卡适配器清单（bus=PCI 为实体卡插槽设备，ROOT 多为虚拟显示适配器；真实显卡以 vendor 为硬件厂商的那条为准）；nvidia=NVIDIA 独显状态。gpuPct 为瞬时采样，可与 proc 的 cpuPct 交叉印证。"
  }
}
```

实测约 3.9 秒返回（两路数据源并行取 + 适配器清单顺带）。

### 无 NVIDIA 的机器：lhmGpu 降级

`nvidia: null` 只说明「未检出 NVIDIA 独显」（nvidia-smi 不存在），
不代表没有显卡。核显机的 GPU 健康由 `lhmGpu` 补位（LHM 用户态，
只开 GPU，取温度 / 负载 / 频率 / 显存等原始传感器读数）：

```jsonc
{
  "gpu": {
    "engineSamples": 120,
    "byGpuPct": [ "…同上，GPU Engine 计数器对核显同样有效…” ],
    "byDedicatedMB": [ "…同上…” ],
    "nvidia": null,
    "lhmGpu": {
      "hardware": ["Intel(R) UHD Graphics 770"],
      "sensors": [
        { "hw": "Intel(R) UHD Graphics 770", "name": "GPU Core", "type": "Temperature", "value": 47 },
        { "hw": "Intel(R) UHD Graphics 770", "name": "GPU Core", "type": "Load", "value": 3.1 }
      ]
    }
  }
}
```

- `lhmGpu.hardware` 为空 = 本机无可读 GPU 传感器（LHM 对部分老核显
  不支持），**不代表没有显卡**——此时 GPU Engine 计数器（byGpuPct）
  仍在，每进程利用率照样可用
- 有 NVIDIA 独显的机器不出此字段（独显状态由 nvidia-smi 提供，更准）

## scope=sensor：温度、风扇、电压、降频（三路免安装数据源）

```
sys({ scope: "sensor" })
```

```jsonc
{
  "sensor": {
    "admin": false,                     // 是否管理员运行
    "pawnio": false,                    // 是否检测到 PawnIO 内核驱动
    "hardware": [
      "MS-Terminator B760M D4",         // 主板
      "12th Gen Intel Core i5-12600KF", // CPU
      "NVIDIA GeForce RTX 5070 Ti"      // 独显
    ],
    "sensorCount": 6,
    "sensors": [
      { "hw": "NVIDIA GeForce RTX 5070 Ti", "name": "GPU Core",           "type": "Temperature", "value": 40.65 },
      { "hw": "NVIDIA GeForce RTX 5070 Ti", "name": "GPU Fan 1",           "type": "Fan",         "value": 1177 },
      { "hw": "NVIDIA GeForce RTX 5070 Ti", "name": "GPU Fan 2",           "type": "Fan",         "value": 1148 },
      { "hw": "NVIDIA GeForce RTX 5070 Ti", "name": "GPU Fan 3",           "type": "Fan",         "value": 1155 },
      { "hw": "NVIDIA GeForce RTX 5070 Ti", "name": "GPU Core Voltage",    "type": "Voltage",      "value": 0.84 },
      { "hw": "NVIDIA GeForce RTX 5070 Ti", "name": "GPU Memory Junction", "type": "Temperature", "value": 52 }
    ],
    "thermalZones": [                   // 主板热区（性能计数器，免管理员）
      { "zone": "\\_tz.tz00", "tempC": 27.9, "passivePct": 100 }
      // passivePct=100 未降热；<100 表示该热区正在被动降热
    ],
    "frequency": {                      // 降频信号（性能计数器，免管理员）
      "cores": 16,
      "minPctOfMax": 73,                // 各核最低频率百分比
      "avgPctOfMax": 94.3
      // min 低 + CPU 负载高 = 过热/功耗降频的直接信号
    },
    // counterErrors 仅在计数器读取失败时出现：
    // "counterErrors": { "thermal": "<原因>", "frequency": null }
    // 对应字段为空是读取失败，不代表机器没有热区/降频计数器
    "notice": "sensors=LHM 可读传感器（GPU 等，免管理员）；thermalZones=主板热区（passivePct<100 表示该热区正在被动降热）；frequency=各核频率占最大频率百分比（minPctOfMax 低 + 负载高 = 过热/功耗降频的直接信号）。CPU 核心温度需内核驱动（PawnIO），零安装约束下不可得，用降频信号替代。（硬件：…）"
  }
}
```

实测 3.6 秒返回（三路数据一条 pwsh 命令内取全，免管理员）。

### 能力边界：CPU 核心温度为什么不可得

CPU 核心温度只能读 CPU 内部 MSR（需内核驱动）。两条路线都不满足零宿主安装：

| 路线 | 结果 |
|---|---|
| LHM ≤0.9.4 内置 WinRing0 | 漏洞驱动（CVE-2020-14979），被微软拦，24H2+ 不可用 |
| LHM 0.9.5+ 改用的 PawnIO | 需在目标机安装驱动，违背零宿主安装 |

因此本 scope 用**降频信号替代温度**：过热的直接后果是降频，
`minPctOfMax` 低 + CPU 负载高即为过热证据，对“电脑卡”诊断甚至
比温度本身更接近结论。精确 CPU 温度的替代手段：进 BIOS 看、
或由机主自行装 PawnIO/HWiNFO（超出本工具职责）。

附：实测记录（2026-09-01，UAC 提权验证）——admin=true 但未装 PawnIO 时，
CPU 硬件枚举正常（55 个传感器，Load 有值）但 Temperature/Clock/Power 全空；
DLL 字符串扫描确认 LHM 0.9.6 无 WinRing0、有 PawnIO 引用。这条链排除了
“提权就能解决”的误判。

## scope=io：电脑卡但 CPU 内存都闲——谁在读写磁盘

现场"电脑卡"最常见的原因不是 CPU / 内存满，而是磁盘 IO 打满——
disk 管容量、proc 管计算资源，谁都答不了"谁在吃 IO"。本 scope 补上：

```
sys({ scope: "io", top: 5 })
```

```jsonc
{
  "io": {
    "intervalSec": 2.2,                  // 实际采样窗口（Stopwatch 计时）
    "disks": [                           // 每物理盘实时 IO，按忙碌度降序
      { "disk": "1 C: D: E:", "queueLen": 0, "busyPct": 7, "readKBs": 30599, "writeKBs": 126 },
      { "disk": "0 F: G:",    "queueLen": 0, "busyPct": 0, "readKBs": 12,    "writeKBs": 3 }
    ],
    "byIo": [                            // 每进程读+写 IO 速率 Top N（仅列有活动的）
      { "name": "MsMpEng",       "pid": 3340,  "ioKBs": 8421.3 },
      { "name": "chrome",        "pid": 15028, "ioKBs": 1339.6 },
      { "name": "SearchIndexer", "pid": 5204,  "ioKBs": 402.1 }
    ],
    "totalProcs": 276,
    "notice": "disks=每物理盘实时 IO（busyPct=磁盘忙碌百分比，持续 >80 或 queueLen 持续 >1 = IO 瓶颈…）；byIo=…。与 disk 的分工：disk 管容量与硬件健康，io 管\"现在谁在读写\"。"
  }
}
```

实测热调用 2.8 秒（本进程首次调用额外有 WMI 磁盘计数器预热，
可达 10 秒，与 overview 冷启动同源）。免管理员。

判读：busyPct 持续高 + queueLen 持续 > 1 = IO 瓶颈，
byIo 榜首即嫌疑人；机械盘 busyPct 长期接近 100% 而吞吐不高，
指向碎片或坏盘前兆（交叉 disk 的 SMART）。

## 实现

### proc：单命令内双采样

CPU 占用率是**差值**（单位时间内的 CPU 时间增量），任何接口都不能一次给出。
在一条 pwsh 命令内完成：

```
Stopwatch 启动
采样 1：Get-Process → Map<pid, TotalProcessorTime.TotalSeconds>
Sleep 1200ms
采样 2：Get-Process → 再取 TotalProcessorTime
cpuPct = 100 × (t2 − t1) / 实际间隔秒 / 逻辑核数
```

关键细节：

- **用 Stopwatch 计实际间隔**，不用 1200ms 名义值——Get-Process 本身
  耗时几百毫秒，名义值会让 CPU% 系统性偏高
- **除以逻辑核数**：TotalProcessorTime 是所有核的累计，
  单进程吃满 16 核时应显示 100% 而不是 1600%
- 两采样间退出/新建的进程自然跳过（Map 里没有对应键）

内存直接取采样 2 的 `WorkingSet64`（工作集：进程实际占用的物理内存），
与任务管理器默认列一致，维修人员可对照验证。

### overview：格式化计数器类双读

一条 pwsh 命令内取六路，除 CPU 占用率外均为纯快照：

| 数据 | 来源 |
|---|---|
| CPU 总占用率 | `Win32_PerfFormattedData_PerfOS_Processor`（`_Total` 实例，读两次取第二次） |
| 物理内存 | `Win32_OperatingSystem`（`TotalVisibleMemorySize` / `FreePhysicalMemory`） |
| 页面文件 | `Win32_PageFileUsage`（分配/当前/峰值用量） |
| 内核内存池 | `Win32_PerfFormattedData_PerfOS_Memory`（PoolNonpaged/PagedBytes，即时值单读即可） |
| 机型 | `Win32_ComputerSystem`（厂商/型号）+ `Win32_BIOS` + `Win32_Processor`（CPU 型号/物理核数） |
| 开机时长 | `Win32_OperatingSystem.LastBootUpTime` 与当前时间差 |

CPU 总占用率不用 `Get-Counter`：英文计数器路径在本机中文系统可用
（见下文“实测排除的坑”），但那是对未本地化计数器组的实测结论，
`\Processor(*)` 组是会被本地化的组之一，不应依赖。改用 WMI 格式化
计数器类——类名永不本地化，且免管理员。

**读两次**：格式化计数器类的首读是 provider 启动以来的累计值，不可信；
预读一次弃用，隔 1 秒再读才是真实的近 1 秒差分。

### gpu：两路计数器 + 适配器清单 + nvidia-smi 并行

```ts
Promise.all([runPwsh(GPU_CMD), nvidiaStatus()])
```

（GPU_CMD 内含计数器两路 + 适配器清单，见下。）

**路 1：GPU Engine 计数器**（Windows 性能计数器，任务管理器同源）。
计数路径 `\GPU Engine(*)\Utilization Percentage`，实例名格式
`pid_<pid>_luid_<..>_phys_<n>_eng_<n>_engtype_<类型>`。
一个进程会出现几十个实例（每种引擎类型一个），按 pid 聚合求和，
`engtypes` 保留聚合前的类型清单。

**路 2：GPU Process Memory 计数器**。`\GPU Process Memory(*)\Dedicated Usage`，
值即专用显存字节，按 pid 聚合。

**路 3：nvidia-smi**（NVIDIA 驱动自带，`System32\nvidia-smi.exe`）。
一条查询拿全温度/功耗/显存/利用率/驱动版本；`existsSync` 检测存在才调用。

**路 4：适配器清单**（`Win32_VideoController`，实测 <0.1s，并入同一条
pwsh 命令顺带）。输出 name/vendor/driver/status/bus；bus 取自
PNPDeviceID 首段（PCI/ROOT/USB…），谁是真实显卡留给模型按
vendor/name 判断，不在此硬编码。虚拟显示适配器（串流/投屏软件装
的）在清单里一目了然——这正是“4 适配器 3 个是虚拟显示”场景的
直接答案，也顺带澄清 `nvidia: null` 的语义（机器不是没有显卡）。

**计数器偶发失败重试**：GPU Engine 计数器实测偶发无效采样，
`collectGpu` 对失败结果重试 1 次再收敛 `{error}`（只重试计数器命令，
nvidia-smi 不重试；连续失败说明计数器真坏了，重试多次只会拉长
等待）。

pid→进程名映射：两路计数器实例合并后对去重 pid 逐个 `Get-Process -Id`，查一次缓存。

### io：同窗口双差分

一条 pwsh 命令内，两路数据共用同一个采样窗口（Stopwatch 计真实间隔）：

| 数据 | 来源 |
|---|---|
| 每进程 IO 速率 | `Win32_Process` 的 `Read/WriteTransferCount`（进程启动以来累计值），两次快照差分 ÷ 实际窗口 |
| 每盘队列 / 忙碌 / 吞吐 | `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` 格式化计数器类，首读丢弃取第二次，busyPct = 100 − PercentIdleTime |

- 进程 IO 不走 `PerfProc` 计数器表（实测 7.8s 过慢，与 proc 同教训）；
  `Win32_Process` 是普通 CIM 枚举，亚秒级
- 计数器类名不随系统语言本地化（同 overview 模式）
- 两采样间退出 / 新建的进程自然跳过；`byIo` 只列速率 > 0 的进程，
  瞬时空闲的机器可能为空数组（合法数据，不是错误）
- `_Total` 磁盘实例丢弃，只报物理盘

### sensor：三路数据源，全部免安装

一条 pwsh 命令内顺序取三路：

| 路 | 数据源 | 内容 |
|---|---|---|
| 1 | LHM 0.9.6 用户态（`lhm\` DLL 随仓库分发，Add-Type 加载） | GPU 温度/风扇/电压（NVAPI）等 |
| 2 | `\Thermal Zone Information(*)\*` 性能计数器 | 热区温度（开尔文→°C）+ 被动降热百分比 |
| 3 | `\Processor Information(*)\% of Maximum Frequency` | 各核频率占最大百分比，min/avg |

实现要点：

- **只开三类硬件**：存储 / 内存 / 嵌入式控制器关闭，避免拉起
  DiskInfoToolkit、RAMSPDToolkit 依赖路径（DLL 虽随包分发，用不到就不加载）
- **NaN 过滤**：LHM 部分传感器首读返回 NaN，`ConvertTo-Json` 会输出
  非法 JSON；入列前验 `IsNaN/IsInfinity`
- **API 变化**：LHM 0.9.x 移除了 `GetHardware()`，改用 `Computer.Hardware`
  属性遍历
- **数量熔断**：传感器上限 200 个，防止异常主板淐出堆积上下文
- **热区合理性过滤**：温度超出 -50~150°C 的热区丢弃（ACPI 缺传感器时
  返回 -273.15°C 之类的伪值）
- **PawnIO 探测**：查注册表 Services 键，装入且管理员时 LHM 自然给出
  CPU/主板传感器（sensors 里多出来的项），notice 会说明
- **计数器失败不静默**：热区/降频计数器读取失败时记录原因到
  `counterErrors`（仅失败时出现）。不自动重试：无法区分"机器本来
  就没有这类计数器"与"偶发失败"，重试无判据；透出原因让模型
  知情后自行决定（与 gpu 的重试不同：GPU Engine 是已知必有的
  计数器，失败必属偶发，重试才有意义）

## 取舍

| 决策 | 备选 | 理由 |
|---|---|---|
| 双采样差分算 CPU%（proc） | `PerfProc` 原始计数器表 | 实测该表查询 7.8 秒，不可接受；双采样 1.9 秒 |
| 格式化计数器类双读算 CPU 总占用（overview） | `Get-Counter \\Processor(_Total)` / `Win32_Processor.LoadPercentage` | 前者英文路径依赖未本地化实测结论，`Processor` 组恰恰会被本地化；后者偶发 null 且粒度粗；WMI 类名永不本地化且免管理员 |
| 采样放 pwsh 命令内 | Node 侧两次调 runPwsh | 三次进程启动 + JSON 序列化的开销远大于命令内 Sleep；且保证间隔计算在同一时钟 |
| 工作集（WS）作内存指标 | 提交内存 / 专用字节 | 与任务管理器默认列一致，可对照验证 |
| GPU 计数器一次 Get-Counter 全取 | 按需过滤实例名 | CounterSamples 一次拿全（452 个），Node 侧过滤更灵活 |
| nvidia-smi 检测附带 | 打包 / 硬依赖 | 驱动组件：有 N 卡的机器必有，无 N 卡装了也没用；不破坏零宿主依赖 |
| 传感器读 LHM 用户态 + 系统计数器 | WMI `MSAcpi_ThermalZoneTemperature` | MSAcpi 要管理员且数据同热区计数器；计数器免管理员，一次 Get-Counter 全取 |
| LHM 随仓库打包 `lhm\` | NuGet 还原 / 宿主安装 / PawnIO | 零宿主安装约束；DLL 是纯文件不是驱动安装，不违背约束；目标机可能无网 |
| 只开 Cpu/Gpu/Motherboard | 全开 | 关掉的硬件类型少加载 DiskInfoToolkit/RAMSPDToolkit 依赖路径 |
| 降频信号替代 CPU 核心温度 | 装 PawnIO / 带 WinRing0 的旧 LHM | 前者违背零安装，后者被微软拦（CVE-2020-14979）；降频是过热的直接后果，诊断上更接近结论 |
| 热区合理性过滤（-50~150°C） | 原样上报 | ACPI 缺传感器时返回伪值，污染上下文 |
| 每进程聚合 + engtypes 清单 | 保留每引擎明细 | 明细 452 行会淹没模型；聚合后 10 行 + 类型清单信息量足够 |
| 适配器清单并入 GPU_CMD 同一条命令 | 单独一路并行 runPwsh | Win32_VideoController 实测 <0.1s，命令内顺带远快于多起一个 pwsh 进程 |
| GPU 计数器失败在 Node 侧重试 1 次 | pwsh 内重试 / 不重试 / 重试多次 | 失败必属偶发（计数器组已知必有），1 次已覆盖实测场景；连续失败是真故障，多次重试只会拉长等待 |
| sensor 计数器失败透出 counterErrors 而非重试 | 静默空数组 / 盲目重试 | 热区/降频计数器不是机器必有（低端主板可能没有），重试无判据；透出原因让模型知情 |
| 无 scope 兜底 overview | scope 必填 | “电脑现在怎么样”是最常见的开场问题，一次调用必有答案；schema 也更省模型选择成本 |

### 实测排除的坑

Windows 性能计数器名称理论上随系统语言本地化
（`\Processor(*)\% Processor Time` 在中文系统是 `\处理器(*)\% 处理器时间`）。
但 **GPU Engine / GPU Process Memory 在中文 Windows 上英文名可用**
（实测确认，本机为中文系统）。这两个计数器组未被本地化。
如果未来遇到其他语言环境取数失败，应在命令里加
`Get-Counter -ListSet` 动态发现路径的降级。

## 已知限制

- `cpuPct` 是 1.2 秒窗口的平均值，瞬时突发会低估；对诊断场景（找常驻大户）足够
- gpuPct 是瞬时采样，空闲时全为 0 属正常，此时看 byDedicatedMB 判断谁在用 GPU
- `engineSamples` 在多 GPU（核显+独显）机器上混合聚合，未按 LUID 分卡
- sensor 的 CPU 核心温度不可得（需内核驱动，零安装约束下放弃）；
  过热诊断用 frequency.minPctOfMax + proc 的 CPU 负载交叉判断；
  注意省电降频同样表现为低频率（实测：空闲时 min 81%，满载 4 核时
  min 90% 且频率未下降——散热充足），低值本身不是过热证据，
  必须结合负载；
  热区温度的身份（CPU 还是主板）由 ACPI 命名决定（如 _TZ.CPUZ），
  本机只有 _TZ.TZ00 一个热区，语义需结合机器型号解读
- `cpuTotalPct` 是近 1 秒差分，瞬时突发可能低估（与 proc.cpuPct 同理）
- adapters 的 bus 判据：PCI 为实体卡插槽设备；ROOT/USB 等其他值
  多为虚拟显示/采集卡/USB 显卡，需按 name 二次判断（反例空间小
  但非零，故不硬编码"哪条是真实显卡"）
- GPU Engine 计数器偶发失败已加 1 次重试，连续失败仍收敛 `{error}`
  （计数器真坏时无能为力，此时 adapters/nvidia 两路仍可用——
  但当前失败即整体报错，二者被一并弃掉，属于已知粗糙点，
  除非实测再次遇见否则不优化）
- sensor 的 counterErrors 仅在计数器读取失败时出现；对应字段为空
  是读取失败，不代表机器没有热区/降频计数器
- 非法参数（scope 枚举外、top 非数字）由 pi 框架拦截：报错文本含
  失败路径 + 错误说明 + 原始参数回显，模型可读可自纠（评估结论：
  pi-ai validation.js `validateToolArguments`，无需工具层额外处理）
- overview 首次调用含 WMI 提供程序预热，可能明显慢于后续调用（实测冷启动约 10 秒，热后约 4 秒——机型/内存池两路查询并入后热调用从 2.5 秒变到约 4 秒，换来的覆盖面值得）；
  io 同理（磁盘计数器预热，冷约 10 秒，热后 2.8 秒）
- io 的 byIo 仅列窗口内有 IO 活动的进程，全部空闲时为空数组（合法数据，不是错误）
- lhmGpu 对部分老核显可能无传感器可读（hardware 为空，不代表没有显卡），
  此时每进程 GPU 利用率（byGpuPct）仍可用
- scope 枚举目前为 `overview` / `proc` / `gpu` / `sensor` / `io`；R5 自启盘点
  已剥离为独立工具 `startup`（见 `doc\tool\startup.md`）
