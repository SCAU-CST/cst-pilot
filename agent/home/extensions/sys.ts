/**
 * sys - 只读系统检查工具（cst-pilot 定制）
 *
 * 结构只读：无任何写路径，注册表 / 系统配置零改动。
 * - scope=proc : 进程盘点。内存取 Get-Process 快照；CPU% 用 1.2s 双采样差分
 *   （不走 PerfProc 原始计数器表，实测该路径 7.8s 过慢）
 * - scope=gpu  : 每进程 GPU 利用率（GPU Engine 计数器按 pid 聚合）+
 *   每进程专用显存（GPU Process Memory）；检测到 nvidia-smi（系统驱动自带）
 *   则附显卡温度 / 功耗 / 显存 / 驱动版本。均不需要管理员权限。
 * - scope=sensor: 温度 / 风扇 / 电压，数据源 LibreHardwareMonitorLib（LHM，
 *   开源硬件传感器库，DLL 打包在仓库 lhm\）。GPU 传感器免管理员；
 *   CPU / 主板传感器的内核级读取依赖 PawnIO 驱动（LHM 0.9.6 起不再内置
 *   WinRing0），未装 PawnIO 或非管理员时自动降级只报可用部分。
 *
 * 里程碑（doc/design/sys_design.md）：R1=proc，R2=gpu，R3=sensor；
 * overview / startup 为后续 scope，实现后扩充枚举。
 */
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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
		notice: `进程 ${r.totalProcs} 个，采样间隔 ${r.intervalSec}s（${r.cores} 逻辑核）。byCpu=CPU 占用率 Top N；byMem=内存（工作集）Top N。cpuPct 为采样窗口内的平均值，瞬时突发可能低估。`,
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

ConvertTo-Json @{ engineSamples = @($eng).Count; byGpuPct = $byPct; byDedicatedMB = $byMem } -Depth 4
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

async function collectGpu(topN: number): Promise<any> {
	const [r, nv] = await Promise.all([runPwsh(GPU_CMD(topN)), nvidiaStatus()]);
	if (r && typeof r.error === "string") return { error: r.error };
	return {
		...r,
		nvidia: nv,
		notice: `GPU Engine ${r.engineSamples} 个实例按进程聚合。byGpuPct=GPU 利用率 Top N（engtypes=所用引擎类型，如 3d/copy/videodecode）；byDedicatedMB=专用显存 Top N；nvidia=NVIDIA 显卡状态（无 NVIDIA 则为 null）。gpuPct 为瞬时采样，可与 proc 的 cpuPct 交叉印证。`,
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
} catch {}

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
} catch {}

ConvertTo-Json @{ admin = $isAdmin; pawnio = [bool]$pawnio; hardware = $hwSeen; sensors = $sensors; thermalZones = $zones; frequency = @{ cores = $fCores; minPctOfMax = $fMin; avgPctOfMax = $fAvg } } -Depth 4
`;

async function collectSensor(): Promise<any> {
	if (!existsSync(LHM_DLL)) {
		return { error: `未找到 LHM DLL（${LHM_DLL}），sensor scope 不可用` };
	}
	const r = await runPwsh(SENSOR_CMD, 30000);
	if (r && typeof r.error === "string") return { error: r.error };
	const hwList = Array.isArray(r.hardware) ? r.hardware.join(" / ") : "";
	const pawnioFull = r.pawnio && r.admin ? "已检测到 PawnIO + 管理员，CPU/主板传感器已包含在 sensors 中。" : "";
	return {
		admin: r.admin,
		pawnio: r.pawnio,
		hardware: r.hardware,
		sensorCount: Array.isArray(r.sensors) ? r.sensors.length : 0,
		sensors: r.sensors,
		thermalZones: r.thermalZones,
		frequency: r.frequency,
		notice:
			`sensors=LHM 可读传感器（GPU 等，免管理员）；thermalZones=主板热区（passivePct<100 表示该热区正在被动降热）；` +
			`frequency=各核频率占最大频率百分比（minPctOfMax 低 + 负载高 = 过热/功耗降频的直接信号）。` +
			`CPU 核心温度需内核驱动（PawnIO），零安装约束下不可得，用降频信号替代。${pawnioFull}` +
			(hwList ? `（硬件：${hwList}）` : ""),
	};
}

/* ------------------------------------------------------------------ */

export default function (pi: any) {
	pi.registerTool({
		name: "sys",
		label: "System Check",
		description:
			"获取系统运行状态的结构化只读信息：scope=proc 进程盘点（内存 Top N + CPU 占用率 Top N，CPU 为 1.2 秒双采样差分）；scope=gpu GPU 状态（每进程 GPU 利用率与专用显存排行；检测到 NVIDIA 显卡时附温度/功耗/显存/驱动版本）；scope=sensor 传感器与过热检测（GPU 温度/风扇/电压 + 主板热区温度 + CPU 降频百分比，全部免管理员免安装；CPU 核心温度需内核驱动，零安装下不可得，以降频信号替代）。只读，不做任何修改。",
		promptSnippet: "Query running processes, GPU load, and hardware sensors (read-only)",
		promptGuidelines: [
			"Use sys scope=proc when the user asks who is using memory/CPU or whether a process is hogging resources.",
			"Use sys scope=gpu when the user asks about GPU load, VRAM usage, or GPU temperature.",
			"Use sys scope=sensor when the user asks about temperatures, fans, voltages, or overheating (provides GPU sensors, thermal zones, and CPU throttling percentage; CPU core temps need a kernel driver and are unavailable).",
		],
		parameters: Type.Object({
			scope: StringEnum(["proc", "gpu", "sensor"] as const, {
				description: "proc=进程盘点（内存+CPU）；gpu=GPU 状态（利用率+显存+NVIDIA 状态）；sensor=温度/风扇/电压",
			}),
			top: Type.Optional(
				Type.Number({ description: "可选，Top N 进程数，默认 10，上限 50。" }),
			),
		}),

		async execute(_toolCallId: string, params: { scope: string; top?: number }) {
			const topN = Math.max(1, Math.min(50, Math.floor(params.top ?? 10)));
			const result: any = {};

			if (params.scope === "proc") {
				result.proc = await collectProc(topN);
			} else if (params.scope === "gpu") {
				result.gpu = await collectGpu(topN);
			} else if (params.scope === "sensor") {
				result.sensor = await collectSensor();
			} else {
				result.error = `未知 scope: ${params.scope}（当前支持 proc / gpu / sensor）`;
			}

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
