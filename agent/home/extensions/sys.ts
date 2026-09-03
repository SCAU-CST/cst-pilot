/**
 * sys - 只读系统检查工具（cst-pilot 定制）
 *
 * 结构只读：无任何写路径，注册表 / 系统配置零改动。
 * - scope=proc : 进程盘点。内存取 Get-Process 快照；CPU% 用 1.2s 双采样差分
 *   （不走 PerfProc 原始计数器表，实测该路径 7.8s 过慢）
 * - scope=gpu  : 每进程 GPU 利用率（GPU Engine 计数器按 pid 聚合，
 *   偶发无效采样时自动重试 1 次）+ 每进程专用显存（GPU Process Memory）
 *   + 显卡适配器清单（Win32_VideoController，含虚拟显示）；检测到 nvidia-smi
 *   （系统驱动自带）则附显卡温度 / 功耗 / 显存 / 驱动版本；无 NVIDIA 时改用
 *   LHM 用户态附核显 / 其他卡传感器（lhmGpu）。均不需要管理员权限。
 * - scope=io   : 每物理盘队列 / 忙碌 / 吞吐 + 每进程读写 IO 速率 Top N
 *   （Win32_Process 累计 IO 计数差分，避开 PerfProc 慢路径）。免管理员。
 * - scope=sensor: 温度 / 风扇 / 电压，数据源 LibreHardwareMonitorLib（LHM，
 *   开源硬件传感器库，DLL 打包在仓库 lhm\）。GPU 传感器免管理员；
 *   CPU / 主板传感器的内核级读取依赖 PawnIO 驱动（LHM 0.9.6 起不再内置
 *   WinRing0），未装 PawnIO 或非管理员时自动降级只报可用部分。
 * - scope=overview: 整机负载概况（R4）。物理内存用量 + CPU 总占用率 +
 *   页面文件状态 + 开机时长 + 内核内存池 + 机型信息
 *   （厂商 / 型号 / CPU / BIOS）。免管理员，纯快照。
 *
 * 里程碑（doc/design/sys_design.md）：R1=proc，R2=gpu，R3=sensor，R4=overview。
 * R5（开机自启盘点）已从 sys 剥离为独立工具 startup.ts（配置盘点与实时
 * 负载不属一类问题，单独注册边界更清晰）。无 scope 时兜底 overview。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const execFileP = promisify(execFile);

const EXT_DIR = dirname(fileURLToPath(import.meta.url)); // .../agent/home/extensions
const ROOT_DIR = join(EXT_DIR, "..", "..", ".."); // cst-pilot 根
const PWSH = join(ROOT_DIR, "pwsh", "pwsh.exe");
const LHM_DLL = join(ROOT_DIR, "lhm", "LibreHardwareMonitorLib.dll");
const NVIDIA_SMI = join(process.env.WINDIR ?? "C:\\Windows", "System32", "nvidia-smi.exe");

/** 智能解码：PowerShell 错误输出可能按系统 ANSI 代码页（中文系统为 GBK）编码，
 *  正常输出为 UTF-8。先按 UTF-8 严格解码，失败则回退 GBK。 */
function decodeBuffer(buf: Buffer | undefined): string {
	if (!buf || buf.length === 0) return "";
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		try {
			return new TextDecoder("gbk").decode(buf);
		} catch {
			return buf.toString("latin1");
		}
	}
}

/** 去掉终端颜色/控制序列，避免乱码污染日志与模型上下文 */
function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** 与 disk.ts 同款：项目自带 pwsh 执行，JSON 解析，失败收敛为 { error } */
async function runPwsh(command: string, timeoutMs = 20000): Promise<any> {
	try {
		const r = await execFileP(
			PWSH,
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
			{ timeout: timeoutMs, windowsHide: true, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
		);
		const stdout = decodeBuffer(r.stdout as Buffer);
		const stderr = stripAnsi(decodeBuffer(r.stderr as Buffer)).trim();
		if (!stdout.trim()) {
			return { error: (stderr || "空输出").slice(0, 500) };
		}
		try {
			return JSON.parse(stdout);
		} catch {
			return JSON.parse(stripAnsi(stdout));
		}
	} catch (e: any) {
		const errStderr = e?.stderr ? stripAnsi(decodeBuffer(e.stderr as Buffer)).trim() : "";
		return { error: (errStderr || String(e?.message ?? e)).slice(0, 500) };
	}
}

/* ------------------------------------------------------------------ */
/* scope=proc · 进程盘点：快照 + 1.2s 双采样差分                        */
/* ------------------------------------------------------------------ */

const PROC_CMD = (topN: number) => `
$ErrorActionPreference = 'SilentlyContinue'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$s1 = @{}
Get-Process | ForEach-Object { if ($_.TotalProcessorTime) { $s1[$_.Id] = $_.TotalProcessorTime.TotalSeconds } }
Start-Sleep -Milliseconds 1200
$sw.Stop()
$iv = $sw.Elapsed.TotalSeconds
$cores = [Environment]::ProcessorCount
$topN = ${topN}
$procs = Get-Process | ForEach-Object {
  $a = $s1[$_.Id]
  if ($null -ne $a -and $_.TotalProcessorTime) {
    [pscustomobject]@{
      name   = $_.ProcessName
      pid    = $_.Id
      wsMB   = [math]::Round($_.WorkingSet64 / 1MB, 0)
      cpuPct = [math]::Round(100 * ($_.TotalProcessorTime.TotalSeconds - $a) / $iv / $cores, 1)
      path   = $_.Path
    }
  }
}
$byCpu = @($procs | Sort-Object cpuPct -Descending | Select-Object -First $topN)
$byMem = @($procs | Sort-Object wsMB -Descending | Select-Object -First $topN)
ConvertTo-Json @{ intervalSec = [math]::Round($iv, 2); cores = $cores; totalProcs = @($procs).Count; byCpu = $byCpu; byMem = $byMem } -Depth 3
`;

async function collectProc(topN: number): Promise<any> {
	const r = await runPwsh(PROC_CMD(topN));
	if (r && typeof r.error === "string") return { error: r.error };
	return {
		...r,
		notice: `进程 ${r.totalProcs} 个，采样间隔 ${r.intervalSec}s（${r.cores} 逻辑核）。byCpu=CPU 占用率 Top N；byMem=内存（工作集）Top N。cpuPct 为采样窗口内的平均值，瞬时突发可能低估。path=可执行文件路径（系统进程或权限不足时为 null，可用于就地验证进程身份）。`,
	};
}

/* ------------------------------------------------------------------ */
/* scope=gpu · 每进程 GPU 利用率 + 专用显存 + nvidia-smi 附带            */
/* ------------------------------------------------------------------ */

const GPU_CMD = (topN: number) => `
$ErrorActionPreference = 'SilentlyContinue'
$topN = ${topN}
try {
  $eng = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples
} catch {
  ConvertTo-Json @{ error = ('GPU 计数器不可用: ' + ($_.Exception.Message)) } -Depth 2
  exit
}
$mem = (Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples

# 显卡适配器清单（Win32_VideoController 实测 <0.1s）：
# bus=PCI 为实体卡插槽设备，ROOT 多为虚拟显示适配器，
# 谁是真实显卡留给模型按 vendor/name 判断，不在此硬编码
$ad = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [pscustomobject]@{
    name   = $_.Name
    vendor = $_.AdapterCompatibility
    driver = $_.DriverVersion
    status = $_.Status
    bus    = if ($_.PNPDeviceID) { ($_.PNPDeviceID -split '\\\\')[0] } else { $null }
  }
})

# pid -> 进程名（只在首次遇到时查一次）
$nameOf = @{}
foreach ($s in @($eng) + @($mem)) {
  if ($s.InstanceName -match 'pid_(\\d+)') {
    $p = [int]$Matches[1]
    if (-not $nameOf.ContainsKey($p)) {
      $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
      if ($proc) { $nameOf[$p] = $proc.ProcessName }
    }
  }
}

# 引擎样本拍平：pid + 引擎类型 + 利用率
$flat = @($eng | ForEach-Object {
  if ($_.InstanceName -match 'pid_(\\d+)') {
    $p = [int]$Matches[1]
    $et = if ($_.InstanceName -match 'engtype_([A-Za-z0-9]+)') { $Matches[1] } else { 'unknown' }
    [pscustomobject]@{ pid = $p; et = $et; val = $_.CookedValue }
  }
})

$byPct = @($flat | Group-Object pid | ForEach-Object {
  [pscustomobject]@{
    pid      = [int]$_.Name
    name     = $nameOf[[int]$_.Name]
    gpuPct   = [math]::Round(($_.Group | Measure-Object val -Sum).Sum, 1)
    engtypes = (($_.Group.et | Sort-Object -Unique) -join '+')
  }
} | Sort-Object gpuPct -Descending | Select-Object -First $topN)

$byMem = @($mem | Where-Object { $_.CookedValue -gt 1MB } | ForEach-Object {
  if ($_.InstanceName -match 'pid_(\\d+)') {
    [pscustomobject]@{ pid = [int]$Matches[1]; mb = [math]::Round($_.CookedValue / 1MB, 0) }
  }
} | Group-Object pid | ForEach-Object {
  [pscustomobject]@{
    pid         = [int]$_.Name
    name        = $nameOf[[int]$_.Name]
    dedicatedMB = [math]::Round(($_.Group | Measure-Object mb -Sum).Sum, 0)
  }
} | Sort-Object dedicatedMB -Descending | Select-Object -First $topN)

ConvertTo-Json @{ engineSamples = @($eng).Count; adapters = $ad; byGpuPct = $byPct; byDedicatedMB = $byMem } -Depth 4
`;

/** nvidia-smi 系统驱动自带：存在则附带显卡状态，不存在返回 null */
async function nvidiaStatus(): Promise<any> {
	if (!existsSync(NVIDIA_SMI)) return null;
	try {
		const r = await execFileP(
			NVIDIA_SMI,
			[
				"--query-gpu=name,temperature.gpu,power.draw,memory.used,memory.total,utilization.gpu,driver_version",
				"--format=csv,noheader,nounits",
			],
			{ timeout: 8000, windowsHide: true, encoding: "utf8" },
		);
		const line = r.stdout.trim().split(/\r?\n/)[0];
		const [name, temp, power, memUsed, memTotal, util, driver] = line.split(",").map((s) => s.trim());
		return {
			name,
			tempC: +temp,
			powerW: +power,
			vramUsedMB: +memUsed,
			vramTotalMB: +memTotal,
			utilPct: +util,
			driver,
		};
	} catch {
		return { error: "nvidia-smi 调用失败" };
	}
}

/** LHM 只开 GPU 的精简查询：无 NVIDIA 独显时的核显 / 其他卡降级路径。
 *  部分老核显 LHM 读不出传感器——返回空 hardware/sensors，
 *  语义区别于 nvidia: null（"未检出 NVIDIA 独显"），由 notice 说明。 */
const LHM_GPU_CMD = `
$ErrorActionPreference = 'Stop'
try { Add-Type -Path '${LHM_DLL}' } catch { ConvertTo-Json @{ error = ('LHM DLL 加载失败: ' + $_.Exception.Message) } -Depth 2; exit }
$c = New-Object LibreHardwareMonitor.Hardware.Computer
$c.IsCpuEnabled = $false
$c.IsGpuEnabled = $true
$c.IsMemoryEnabled = $false
$c.IsMotherboardEnabled = $false
$c.IsStorageEnabled = $false
$c.IsControllerEnabled = $false
$c.IsPsuEnabled = $false
$c.IsBatteryEnabled = $false
try { $c.Open() } catch { ConvertTo-Json @{ error = ('LHM Open 失败: ' + $_.Exception.Message) } -Depth 2; exit }
$sensors = @()
$hwSeen = @()
foreach ($hw in $c.Hardware) {
  try { $hw.Update() } catch {}
  if ("$($hw.HardwareType)" -like 'Gpu*') { $hwSeen += $hw.Name }
  $all = @($hw.Sensors)
  foreach ($sub in $hw.SubHardware) { try { $sub.Update() } catch {}; $all += @($sub.Sensors) }
  foreach ($s in $all) {
    $t = "$($s.SensorType)"
    if ($t -in 'Temperature','Load','Clock','Power','Fan','SmallData','Data' -and $null -ne $s.Value -and -not [double]::IsNaN([double]$s.Value) -and -not [double]::IsInfinity([double]$s.Value)) {
      $sensors += [pscustomobject]@{
        hw    = $hw.Name
        name  = $s.Name
        type  = $t
        value = [math]::Round($s.Value, 2)
      }
    }
  }
}
$c.Close()
ConvertTo-Json @{ hardware = $hwSeen; sensors = $sensors } -Depth 3
`;

async function lhmGpuStatus(): Promise<any> {
	if (!existsSync(LHM_DLL)) return { hardware: [], sensors: [], notice: "LHM DLL 缺失，GPU 传感器不可读" };
	const r = await runPwsh(LHM_GPU_CMD, 20000);
	if (r && typeof r.error === "string") return { hardware: [], sensors: [], notice: `LHM 读取失败: ${r.error}` };
	return { hardware: Array.isArray(r.hardware) ? r.hardware : [], sensors: Array.isArray(r.sensors) ? r.sensors : [] };
}

async function collectGpu(topN: number): Promise<any> {
	// GPU Engine 计数器偶发无效采样（实测观察到过）：失败重试 1 次再收敛为 {error}。
	// 重试会重跑 GPU_CMD（适配器清单随重跑更新）；nvidia-smi 只在首次调用，结果复用。
	const [first, nv] = await Promise.all([runPwsh(GPU_CMD(topN)), nvidiaStatus()]);
	const r = first && typeof first.error === "string" ? await runPwsh(GPU_CMD(topN)) : first;
	if (r && typeof r.error === "string") return { error: r.error };
	const out: any = { ...r, nvidia: nv };
	if (!nv) out.lhmGpu = await lhmGpuStatus();
	out.notice =
		`GPU Engine ${r.engineSamples} 个实例按进程聚合。byGpuPct=GPU 利用率 Top N（engtypes=所用引擎类型，如 3d/copy/videodecode）；byDedicatedMB=专用显存 Top N；adapters=显卡适配器清单（bus=PCI 为实体卡插槽设备，ROOT 多为虚拟显示适配器；真实显卡以 vendor 为硬件厂商的那条为准）；` +
		(nv
			? `nvidia=NVIDIA 独显状态。`
			: `nvidia=null=未检出 NVIDIA 独显（nvidia-smi 不存在），核显 / 其他卡状态见 lhmGpu（LHM 用户态原始传感器读数；lhmGpu.hardware 为空=本机无可读 GPU 传感器，不代表没有显卡）。`) +
		`gpuPct 为瞬时采样，可与 proc 的 cpuPct 交叉印证。`;
	return out;
}

/* ------------------------------------------------------------------ */
/* scope=io · 磁盘 IO 定位：每盘队列 / 吞吐 + 每进程 IO 速率             */
/* ------------------------------------------------------------------ */

// "电脑卡但 CPU 内存都闲"的最常见原因是磁盘 IO 打满。两路数据共用同一个
// 1.2s 采样窗口，一条 pwsh 命令取全：
// 1) 每进程 IO：Win32_Process 的 Read/WriteTransferCount 是进程启动以来
//    的累计值，两次快照差分即速率。不走 PerfProc 计数器表（实测 7.8s 过慢，
//    同 proc scope 的教训）；Win32_Process 是普通 CIM 枚举，快。
// 2) 每盘队列：Win32_PerfFormattedData_PerfDisk_PhysicalDisk 格式化计数器类
//    （类名不随系统语言本地化，同 overview 模式），首读丢弃取第二次。
const IO_CMD = (topN: number) => `
$ErrorActionPreference = 'SilentlyContinue'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$s1 = @{}
Get-CimInstance Win32_Process | ForEach-Object { $s1[$_.ProcessId] = [double]$_.ReadTransferCount + [double]$_.WriteTransferCount }
$null = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk
Start-Sleep -Milliseconds 1200
$s2 = @{}
Get-CimInstance Win32_Process | ForEach-Object { $s2[$_.ProcessId] = @{ n = ($_.Name -replace '\\.exe$',''); io = [double]$_.ReadTransferCount + [double]$_.WriteTransferCount } }
$sw.Stop()
$iv = $sw.Elapsed.TotalSeconds
$topN = ${topN}
$byIo = @($s2.Keys | ForEach-Object {
  $id = $_
  if ($s1.ContainsKey($id)) {
    $kbs = [math]::Round(($s2[$id].io - $s1[$id]) / $iv / 1KB, 1)
    if ($kbs -gt 0) {
      [pscustomobject]@{ name = $s2[$id].n; pid = $id; ioKBs = $kbs }
    }
  }
} | Sort-Object ioKBs -Descending | Select-Object -First $topN)
$disks = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk |
  Where-Object { $_.Name -ne '_Total' } |
  ForEach-Object {
    [pscustomobject]@{
      disk     = $_.Name
      queueLen = $_.CurrentDiskQueueLength
      busyPct  = [math]::Round([math]::Max(0, [math]::Min(100, 100 - $_.PercentIdleTime)), 1)
      readKBs  = [math]::Round($_.DiskReadBytesPersec / 1KB, 0)
      writeKBs = [math]::Round($_.DiskWriteBytesPersec / 1KB, 0)
    }
  } | Sort-Object busyPct -Descending)
ConvertTo-Json @{ intervalSec = [math]::Round($iv, 2); disks = $disks; byIo = $byIo; totalProcs = $s2.Count } -Depth 3
`;

async function collectIo(topN: number): Promise<any> {
	const r = await runPwsh(IO_CMD(topN), 20000);
	if (r && typeof r.error === "string") return { error: r.error };
	return {
		...r,
		notice: `disks=每物理盘实时 IO（busyPct=磁盘忙碌百分比，持续 >80 或 queueLen 持续 >1 = IO 瓶颈；readKBs/writeKBs=读写吞吐）；byIo=每进程读+写 IO 速率 Top N（${r.intervalSec}s 差分，仅列有活动的进程，瞬时空闲可能无条目）。与 disk 的分工：disk 管容量与硬件健康，io 管"现在谁在读写"。`,
	};
}

/* ------------------------------------------------------------------ */
/* scope=sensor · 温度 / 风扇 / 电压 / 降频（LHM 用户态 + 系统计数器）     */
/* ------------------------------------------------------------------ */

// 三路数据，全部免安装：
// 1) LHM 0.9.6 用户态部分（GPU 走 NVAPI）：DLL 随仓库分发，Add-Type 加载。
//    CPU/主板传感器需要 PawnIO 内核驱动（LHM 0.9.5 起不再内置 WinRing0），
//    零宿主安装约束下不提供——用降频信号（路 3）替代过热诊断。
// 2) 热区：Thermal Zone Information 性能计数器，免管理员（MSAcpi WMI 反而要
//    管理员，且数据同源，弃用）。温度开尔文，% Passive Limit < 100 表示
//    该热区正在被动降热。
// 3) 降频：% of Maximum Frequency 各核当前频率占最大频率百分比。
//    低值 + 高负载 = 过热/功耗降频的直接信号。
const SENSOR_CMD = `
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$pawnio = Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\PawnIO'
try { Add-Type -Path '${LHM_DLL}' } catch { ConvertTo-Json @{ error = ('LHM DLL 加载失败: ' + $_.Exception.Message) } -Depth 2; exit }
$c = New-Object LibreHardwareMonitor.Hardware.Computer
$c.IsCpuEnabled = $true
$c.IsGpuEnabled = $true
$c.IsMotherboardEnabled = $true
$c.IsMemoryEnabled = $false
$c.IsStorageEnabled = $false
$c.IsControllerEnabled = $false
$c.IsPsuEnabled = $false
$c.IsBatteryEnabled = $false
try { $c.Open() } catch { ConvertTo-Json @{ error = ('LHM Open 失败: ' + $_.Exception.Message) } -Depth 2; exit }
$sensors = @()
$hwSeen = @()
foreach ($hw in $c.Hardware) {
  try { $hw.Update() } catch {}
  $hwSeen += $hw.Name
  $all = @($hw.Sensors)
  foreach ($sub in $hw.SubHardware) { try { $sub.Update() } catch {}; $all += @($sub.Sensors) }
  foreach ($s in $all) {
    $t = "$($s.SensorType)"
    if ($t -in 'Temperature','Fan','Voltage' -and $null -ne $s.Value -and -not [double]::IsNaN([double]$s.Value) -and -not [double]::IsInfinity([double]$s.Value)) {
      $sensors += [pscustomobject]@{
        hw    = $hw.Name
        name  = $s.Name
        type  = $t
        value = [math]::Round($s.Value, 2)
      }
    }
    if ($sensors.Count -ge 200) { break }
  }
  if ($sensors.Count -ge 200) { break }
}
$c.Close()

# 热区（免管理员）：温度 K→°C，被动降热百分比
$zoneErr = $null; $freqErr = $null
$zones = @()
try {
  $zones = @((Get-Counter '\\Thermal Zone Information(*)\\*' -ErrorAction Stop).CounterSamples |
    Group-Object InstanceName | ForEach-Object {
      $t = $_.Group | Where-Object { $_.Path -like '*\\temperature' } | Select-Object -First 1
      $p = $_.Group | Where-Object { $_.Path -like '*passive limit*' } | Select-Object -First 1
      if ($null -eq $t) { return }
      $tc = [math]::Round($t.CookedValue - 273.15, 1)
      if ($tc -lt -50 -or $tc -gt 150) { return }
      [pscustomobject]@{
        zone       = $_.Name
        tempC      = $tc
        passivePct = if ($p) { [math]::Round($p.CookedValue, 0) } else { $null }
      }
    })
} catch { $zoneErr = $_.Exception.Message }

# 降频（免管理员）：各核频率占最大百分比
$fMin = $null; $fAvg = $null; $fCores = 0
try {
  $f = @((Get-Counter '\\Processor Information(*)\\% of Maximum Frequency' -ErrorAction Stop).CounterSamples |
    Where-Object { $_.InstanceName -match '^\\d+,\\d+$' })
  $fCores = $f.Count
  if ($f.Count -gt 0) {
    $vals = @($f | ForEach-Object { $_.CookedValue })
    $fMin = [math]::Round(($vals | Measure-Object -Minimum).Minimum, 1)
    $fAvg = [math]::Round(($vals | Measure-Object -Average).Average, 1)
  }
} catch { $freqErr = $_.Exception.Message }

ConvertTo-Json @{ admin = $isAdmin; pawnio = [bool]$pawnio; hardware = $hwSeen; sensors = $sensors; thermalZones = $zones; frequency = @{ cores = $fCores; minPctOfMax = $fMin; avgPctOfMax = $fAvg }; counterErrors = @{ thermal = $zoneErr; frequency = $freqErr } } -Depth 4
`;

async function collectSensor(): Promise<any> {
	if (!existsSync(LHM_DLL)) {
		return { error: `未找到 LHM DLL（${LHM_DLL}），sensor scope 不可用` };
	}
	const r = await runPwsh(SENSOR_CMD, 30000);
	if (r && typeof r.error === "string") return { error: r.error };
	const hwList = Array.isArray(r.hardware) ? r.hardware.join(" / ") : "";
	const pawnioFull = r.pawnio && r.admin ? "已检测到 PawnIO + 管理员，CPU/主板传感器已包含在 sensors 中。" : "";
	// 计数器失败不静默：透出原因。无法区分"机器本来就没有"与"偶发失败"，
	// 重试无判据，故不自动重试，让模型知情后自行决定。
	const cErr = r.counterErrors ?? {};
	const out: any = {
		admin: r.admin,
		pawnio: r.pawnio,
		hardware: r.hardware,
		sensorCount: Array.isArray(r.sensors) ? r.sensors.length : 0,
		sensors: r.sensors,
		thermalZones: r.thermalZones,
		frequency: r.frequency,
	};
	if (cErr.thermal || cErr.frequency) out.counterErrors = cErr;
	out.notice =
		`sensors=LHM 可读传感器（GPU 等，免管理员）；thermalZones=主板热区（passivePct<100 表示该热区正在被动降热）；` +
		`frequency=各核频率占最大频率百分比（minPctOfMax 低 + 负载高 = 过热/功耗降频的直接信号）。` +
		`CPU 核心温度需内核驱动（PawnIO），零安装约束下不可得，用降频信号替代。${pawnioFull}` +
		(cErr.thermal || cErr.frequency
			? `注意：计数器部分读取失败（${[cErr.thermal, cErr.frequency].filter(Boolean).join("；")}），对应字段为空是读取失败，不代表机器没有热区/降频计数器。`
			: "") +
		(hwList ? `（硬件：${hwList}）` : "");
	return out;
}

/* ------------------------------------------------------------------ */
/* scope=overview · 整机负载概况：内存 / CPU 总占用 / 页面文件 / 开机时长 */
/* ------------------------------------------------------------------ */

// 免管理员，纯快照（近 1 秒差分除外，见下）。
// CPU 总占用：Win32_PerfFormattedData_PerfOS_Processor（WMI 格式化计数器类，
// 类名不随系统语言本地化，避开 Get-Counter 英文路径在本机可用的脆弱依赖）。
// 该类首读是 provider 启动以来的累计值不可信，读两次取第二次。
const OVERVIEW_CMD = `
$ErrorActionPreference = 'SilentlyContinue'
$null = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor
Start-Sleep -Milliseconds 1000
$cpuPct = [math]::Round((Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor |
  Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1).PercentProcessorTime, 1)

$os = Get-CimInstance Win32_OperatingSystem
$totalMB = [math]::Round($os.TotalVisibleMemorySize / 1KB, 0)
$freeMB  = [math]::Round($os.FreePhysicalMemory / 1KB, 0)
$usedMB  = $totalMB - $freeMB
$up = (Get-Date) - $os.LastBootUpTime
$uptime = if ($up.Days -gt 0) { '{0}天{1}小时{2}分' -f $up.Days, $up.Hours, $up.Minutes } else { '{0}小时{1}分' -f $up.Hours, $up.Minutes }

$pf = @(Get-CimInstance Win32_PageFileUsage | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; allocMB = $_.AllocatedBaseSize; usedMB = $_.CurrentUsage; peakMB = $_.PeakUsage }
})

# 内核内存池（格式化类即时值，单读即可）：驱动泄漏定位——
# "内存高但 proc.byMem 对不上大户"时看这里
$pm = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$pool = if ($pm) { @{ nonpagedMB = [math]::Round($pm.PoolNonpagedBytes / 1MB, 0); pagedMB = [math]::Round($pm.PoolPagedBytes / 1MB, 0) } } else { $null }

# 机型信息（现成字段）：品牌机型决定已知问题清单（散热缺陷、OEM 预装坑）
$cs   = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$cpu0 = Get-CimInstance Win32_Processor | Select-Object -First 1
$machine = @{
  vendor        = $cs.Manufacturer
  model         = $cs.Model
  cpu           = if ($cpu0 -and $cpu0.Name) { ($cpu0.Name -replace '\\s+', ' ').Trim() } else { $null }
  physicalCores = if ($cpu0) { $cpu0.NumberOfCores } else { $null }
  bios          = if ($bios) { ('{0} {1}' -f $bios.Manufacturer, $bios.SMBIOSBIOSVersion).Trim() } else { $null }
  biosDate      = if ($bios -and $bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null }
}

ConvertTo-Json @{
  cpuTotalPct  = $cpuPct
  logicalCores = [Environment]::ProcessorCount
  mem          = @{ totalMB = $totalMB; usedMB = $usedMB; freeMB = $freeMB; usedPct = [math]::Round(100 * $usedMB / [math]::Max($totalMB, 1), 1) }
  pagefile     = $pf
  pool         = $pool
  machine      = $machine
  uptime       = @{ bootTime = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm'); text = $uptime; totalHours = [math]::Round($up.TotalHours, 1) }
} -Depth 3
`;

async function collectOverview(): Promise<any> {
	const r = await runPwsh(OVERVIEW_CMD, 20000);
	if (r && typeof r.error === "string") return { error: r.error };
	return {
		...r,
		notice: `整机负载快照。mem=物理内存用量（usedPct>90 提示内存吃紧，可与 proc.byMem 对照找大户）；cpuTotalPct=整机 CPU 占用率（近 1 秒差分，可与 proc.byCpu 对照）；pagefile=页面文件分配/当前/峰值用量（usedMB 持续接近 allocMB 说明物理内存不足在靠页面文件撑）；pool=内核内存池（nonpaged 不可换出，持续异常增长多为驱动泄漏——内存高但进程榜单对不上大户时看这里）；machine=机型（vendor/model/cpu/bios，现场按机型匹配已知问题：散热缺陷、OEM 预装坑）；uptime=开机时长。`,
	};
}

/* ------------------------------------------------------------------ */

export default function (pi: any) {
	pi.registerTool({
		name: "sys",
		label: "System Check",
		description:
			"只读系统检查工具，按 scope 选择子功能（不传默认 overview）：overview=整机负载快照（内存/CPU/页面文件/内存池/机型/开机时长）；proc=进程内存与 CPU 占用 Top N（含可执行文件路径）；io=每盘队列/吞吐 + 每进程 IO 速率 Top N（磁盘瓶颈定位）；gpu=每进程 GPU 利用率与显存排行（附适配器清单；有 NVIDIA 时附显卡状态，无 NVIDIA 时附核显/其他卡传感器）；sensor=温度/风扇/电压/降频信号（过热诊断）。详细指南与诊断交叉印证链见 skill「sys」。",
		promptSnippet:
			"Query overall system load, running processes, disk IO, GPU load, and hardware sensors (read-only)",
		promptGuidelines: [
			"Use sys scope=overview (or omit scope) when the user asks whether the machine is loaded/sluggish overall: gives RAM usage, total CPU load, pagefile pressure, kernel memory pool, machine model (vendor/model/CPU/BIOS), and uptime in one snapshot.",
			"Use sys scope=proc when the user asks who is using memory/CPU or whether a process is hogging resources.",
			"Use sys scope=io when the machine feels slow but CPU and memory look idle: shows per-disk busy/queue/read-write throughput and which processes are doing disk IO.",
			"Use sys scope=gpu when the user asks about GPU load, VRAM usage, GPU temperature, or which graphics card the machine has (adapters list shows real and virtual display adapters).",
			"Use sys scope=sensor when the user asks about temperatures, fans, voltages, or overheating (provides GPU sensors, thermal zones, and CPU throttling percentage; CPU core temps need a kernel driver and are unavailable).",
		],
		parameters: Type.Object({
			scope: Type.Optional(StringEnum(["overview", "proc", "gpu", "sensor", "io"] as const)),
			top: Type.Optional(Type.Number({ description: "可选，Top N 进程数，默认 10，上限 50。" })),
		}),

		async execute(_toolCallId: string, params: { scope?: string; top?: number }) {
			const topN = Math.max(1, Math.min(50, Math.floor(params.top ?? 10)));
			const scope = params.scope ?? "overview"; // 无 scope 兜底 overview：一次调用回答“电脑现在怎么样”
			const result: any = {};

			if (scope === "proc") {
				result.proc = await collectProc(topN);
			} else if (scope === "gpu") {
				result.gpu = await collectGpu(topN);
			} else if (scope === "sensor") {
				result.sensor = await collectSensor();
			} else if (scope === "overview") {
				result.overview = await collectOverview();
			} else if (scope === "io") {
				result.io = await collectIo(topN);
			} else {
				result.error = `未知 scope: ${scope}（当前支持 overview / proc / gpu / sensor / io）`;
			}

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
