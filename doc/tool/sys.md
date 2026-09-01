# sys — 系统检查工具（R1/R2/R3）

实现：`agent\home\extensions\sys.ts`。需求见 `doc\PRD.md`，设计见 `doc\design\sys_design.md`。

## 背景

ls/disk 覆盖的是静态存储。维修现场另一半问题——"谁在吃内存、
CPU 是否跑满、GPU 忙不忙、温度是否异常"——属于**运行时状态**，
此前无工具可答。

R1（进程盘点）、R2（GPU 状态）、R3（传感器）是 sys 的前三个 scope。
scope 即工具内部的子功能开关：`sys` 只注册一个工具名，
调用时用 `scope` 参数选择查进程、查 GPU 还是查传感器
（架构选型见 sys_design.md）。

## 调用方式

| 参数 | 必填 | 说明 |
|---|---|---|
| `scope` | 是 | `proc`=进程盘点；`gpu`=GPU 状态；`sensor`=温度/风扇/电压（后续里程碑扩充 overview/startup） |
| `top` | 否 | Top N，默认 10，上限 50，仅 proc/gpu 有效 |


## LLM 收到的提示词

系统提示词 `Available tools:` 列表中的行：

```
- sys: Query running processes, GPU load, and hardware sensors (read-only)
```

系统提示词 `Guidelines:` 中的条目：

```
- Use sys scope=proc when the user asks who is using memory/CPU or whether a process is hogging resources.
- Use sys scope=gpu when the user asks about GPU load, VRAM usage, or GPU temperature.
- Use sys scope=sensor when the user asks about temperatures, fans, voltages, or overheating (provides GPU sensors, thermal zones, and CPU throttling percentage; CPU core temps need a kernel driver and are unavailable).
```

Function schema（每次请求的 tools 数组中）：

```jsonc
{
  "name": "sys",
  "description": "获取系统运行状态的结构化只读信息：scope=proc 进程盘点（内存 Top N + CPU 占用率 Top N，CPU 为 1.2 秒双采样差分）；scope=gpu GPU 状态（每进程 GPU 利用率与专用显存排行；检测到 NVIDIA 显卡时附温度/功耗/显存/驱动版本）；scope=sensor 传感器与过热检测（GPU 温度/风扇/电压 + 主板热区温度 + CPU 降频百分比，全部免管理员免安装；CPU 核心温度需内核驱动，零安装下不可得，以降频信号替代）。只读，不做任何修改。",
  "parameters": {
    "type": "object",
    "required": ["scope"],
    "properties": {
      "scope": { "type": "string", "enum": ["proc", "gpu", "sensor"], "description": "proc=进程盘点（内存+CPU）；gpu=GPU 状态（利用率+显存+NVIDIA 状态）；sensor=温度/风扇/电压/降频" },
      "top":   { "type": "number", "description": "可选，Top N 进程数，默认 10，上限 50。" }
    }
  }
}
```

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
      { "name": "com.docker.backend", "pid": 24320, "wsMB": 126, "cpuPct": 5.4 },
      { "name": "node",  "pid": 19004, "wsMB": 393, "cpuPct": 0.8 },
      { "name": "node",  "pid": 22276, "wsMB": 324, "cpuPct": 0.7 }
    ],
    "byMem": [                          // 内存（工作集）Top N
      { "name": "node",   "pid": 10224, "wsMB": 1425, "cpuPct": 0 },
      { "name": "Weixin", "pid": 22456, "wsMB": 528,  "cpuPct": 0.1 },
      { "name": "node",   "pid": 19004, "wsMB": 393,  "cpuPct": 0.8 }
    ],
    "notice": "进程 276 个，采样间隔 1.44s（16 逻辑核）。byCpu=CPU 占用率 Top N；byMem=内存（工作集）Top N。cpuPct 为采样窗口内的平均值，瞬时突发可能低估。"
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
    "nvidia": {                         // nvidia-smi 附带；无 NVIDIA 显卡时为 null
      "name": "NVIDIA GeForce RTX 5070 Ti",
      "tempC": 51, "powerW": 33.5,
      "vramUsedMB": 7490, "vramTotalMB": 16303,
      "utilPct": 4, "driver": "591.86"
    },
    "notice": "GPU Engine 452 个实例按进程聚合。byGpuPct=GPU 利用率 Top N（engtypes=所用引擎类型…）；byDedicatedMB=专用显存 Top N；nvidia=NVIDIA 显卡状态（无 NVIDIA 则为 null）。gpuPct 为瞬时采样，可与 proc 的 cpuPct 交叉印证。"
  }
}
```

实测 3.7 秒返回（两路数据源并行取）。

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

### gpu：三路数据并行

```ts
Promise.all([runPwsh(GPU_CMD), nvidiaStatus()])
```

**路 1：GPU Engine 计数器**（Windows 性能计数器，任务管理器同源）。
计数路径 `\GPU Engine(*)\Utilization Percentage`，实例名格式
`pid_<pid>_luid_<..>_phys_<n>_eng_<n>_engtype_<类型>`。
一个进程会出现几十个实例（每种引擎类型一个），按 pid 聚合求和，
`engtypes` 保留聚合前的类型清单。

**路 2：GPU Process Memory 计数器**。`\GPU Process Memory(*)\Dedicated Usage`，
值即专用显存字节，按 pid 聚合。

**路 3：nvidia-smi**（NVIDIA 驱动自带，`System32\nvidia-smi.exe`）。
一条查询拿全温度/功耗/显存/利用率/驱动版本；`existsSync` 检测存在才调用。

pid→进程名映射：两路计数器实例合并后对去重 pid 逐个 `Get-Process -Id`，查一次缓存。

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

## 取舍

| 决策 | 备选 | 理由 |
|---|---|---|
| 双采样差分算 CPU% | `PerfProc` 原始计数器表 | 实测该表查询 7.8 秒，不可接受；双采样 1.9 秒 |
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
- scope 枚举目前只有 `proc` / `gpu` / `sensor`；`overview` / `startup`
  随里程碑 3/5 扩充（见 sys_design.md）
