import { join } from "node:path";
import { COUNTER_HELPERS, psString } from "./pwsh-data.ts";
import { ROOT_DIR } from "./runtime.ts";
export const LHM_DLL = join(ROOT_DIR, "lhm", "LibreHardwareMonitorLib.dll");

export const buildProcessCommand = (topN: number) => `
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

export const buildGpuCommand = (topN: number) => `
$ErrorActionPreference = 'SilentlyContinue'
${COUNTER_HELPERS}
$topN = ${topN}
$engErr = $null; $memErr = $null
try {
  $eng = (Get-DiagnosticCounter 'GPU Engine' 'Utilization Percentage').CounterSamples
} catch {
  $eng = @(); $engErr = $_.Exception.Message
}
try { $mem = (Get-DiagnosticCounter 'GPU Process Memory' 'Dedicated Usage').CounterSamples } catch { $mem = @(); $memErr = $_.Exception.Message }

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
    $adapter = if ($_.InstanceName -match 'luid_(.+?)_phys_(\\d+)') { $Matches[0] } else { 'unknown' }
    if (-not [double]::IsNaN($_.CookedValue) -and -not [double]::IsInfinity($_.CookedValue)) {
      [pscustomobject]@{ pid = $p; adapter = $adapter; et = $et; val = [math]::Max(0, [math]::Min(100, $_.CookedValue)) }
    }
  }
})

$byPct = @($flat | Group-Object pid | ForEach-Object {
  [pscustomobject]@{
    pid      = [int]$_.Name
    name     = $nameOf[[int]$_.Name]
    gpuPct   = [math]::Round(($_.Group | Measure-Object val -Maximum).Maximum, 1)
    engtypes = (($_.Group.et | Sort-Object -Unique) -join '+')
    engines = @($_.Group | ForEach-Object { [pscustomobject]@{ adapter = $_.adapter; type = $_.et; gpuPct = [math]::Round($_.val, 1) } })
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

ConvertTo-Json @{ engineSamples = @($eng).Count; adapters = $ad; byGpuPct = $byPct; byDedicatedMB = $byMem; counterErrors = @{ engine = $engErr; memory = $memErr } } -Depth 6
`;

export const LHM_GPU_CMD = `
$ErrorActionPreference = 'Stop'
try { Add-Type -Path ${psString(LHM_DLL)} } catch { ConvertTo-Json @{ error = ('LHM DLL 加载失败: ' + $_.Exception.Message) } -Depth 2; exit }
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

export const buildIoCommand = (topN: number) => `
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

export const SENSOR_CMD = `
${COUNTER_HELPERS}
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$pawnio = Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\PawnIO'
try { Add-Type -Path ${psString(LHM_DLL)} } catch { ConvertTo-Json @{ error = ('LHM DLL 加载失败: ' + $_.Exception.Message) } -Depth 2; exit }
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
  $temperatureName = (Get-LocalizedCounterPath 'Thermal Zone Information' 'Temperature').Split('\\')[-1]
  $passiveName = (Get-LocalizedCounterPath 'Thermal Zone Information' '% Passive Limit').Split('\\')[-1]
  $zones = @((Get-DiagnosticCounter 'Thermal Zone Information' @('Temperature', '% Passive Limit')).CounterSamples |
    Group-Object InstanceName | ForEach-Object {
      $t = $_.Group | Where-Object { $_.Path.EndsWith(('\\' + $temperatureName), [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
      $p = $_.Group | Where-Object { $_.Path.EndsWith(('\\' + $passiveName), [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
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
  $f = @((Get-DiagnosticCounter 'Processor Information' '% of Maximum Frequency').CounterSamples |
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

export const OVERVIEW_CMD = `
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
