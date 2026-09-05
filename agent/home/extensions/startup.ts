/**
 * startup - 只读开机自启盘点工具（cst-pilot 定制）
 *
 * 从 sys 工具体系剥离的独立工具（原 sys R5）：开机自启盘点是**配置盘点**
 * 而非实时负载，与 sys 的"此刻发生了什么"不属一类问题，单独注册
 * 一个工具，边界更清晰（决策记录见 doc/design/sys_design.md 待拍板）。
 *
 * 结构只读：注册表只读枚举（Get-Item / Test-Path），无任何写路径。
 * - 注册表自启项：HKLM / HKCU 的 Run / RunOnce + HKLM Wow6432Node\Run
 *   （32 位程序在 64 位系统上的自启落点）
 * - 启动文件夹：当前用户 + 所有用户
 * - 自启服务：Win32_Service StartMode='Auto'（含延迟自启）
 * - 禁用状态：读 StartupApproved 键（任务管理器"启动应用"开关的落点），
 *   首字节奇数 = 已禁用；已禁用项不会开机拉起，如实标注避免误报
 */

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "typebox";
import { collectionNotice, diagnosticCommand } from "./pwsh-data";

const execFileP = promisify(execFile);

const EXT_DIR = dirname(fileURLToPath(import.meta.url)); // .../agent/home/extensions
const ROOT_DIR = join(EXT_DIR, "..", "..", ".."); // cst-pilot 根
const PWSH = join(ROOT_DIR, "pwsh", "pwsh.exe");

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

/** 与 disk.ts / sys.ts 同款：项目自带 pwsh 执行，JSON 解析，失败收敛为 { error } */
async function runPwsh(command: string, timeoutMs = 20000): Promise<any> {
	try {
		const r = await execFileP(
			PWSH,
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", diagnosticCommand(command)],
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
/* 自启盘点：注册表 Run 键 + 启动文件夹 + 自启服务，一条 pwsh 命令内取全  */
/* ------------------------------------------------------------------ */

// 全部只读：Get-Item 枚举注册表值、Get-ChildItem 列文件夹、
// Get-CimInstance 查服务。StartupApproved 首字节奇数 = 任务管理器已禁用。
const STARTUP_CMD = `
$ErrorActionPreference = 'SilentlyContinue'

# 1) 注册表 Run / RunOnce（HKLM 含 Wow6432Node：32 位程序在 64 位系统上的自启落点）
$reg = @()
foreach ($k in @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
)) {
  if (-not (Test-Path $k)) { continue }
  $it = Get-Item -Path $k
  foreach ($n in $it.GetValueNames()) {
    $v = $it.GetValue($n)
    if ($null -ne $v) {
      $reg += [pscustomobject]@{ source = $k -replace '^HKLM:\\\\', 'HKLM\\' -replace '^HKCU:\\\\', 'HKCU\\'; name = $n; command = [string]$v; approval = if ($k.EndsWith("RunOnce")) { $null } else { ($k -split ":")[0] + "/" + $(if ($k.Contains("Wow6432Node")) { "Run32" } else { "Run" }) + "/" + $n } }
    }
  }
}

# 2) StartupApproved（任务管理器"启动应用"开关落点）：首字节奇数 = 已禁用
$dis = @{}
foreach ($sap in @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'
)) {
  if (-not (Test-Path $sap)) { continue }
  $it = Get-Item -Path $sap
  foreach ($n in $it.GetValueNames()) {
    $b = $it.GetValue($n, $null) -as [byte[]]
    if ($b -and $b.Length -gt 0) { $dis[(($sap -split ":")[0] + "/" + ($sap -split "\\\\")[-1] + "/" + $n)] = (($b[0] % 2) -eq 1) }
  }
}
$reg = @($reg | ForEach-Object {
  $disabled = if ($_.approval) { $dis[$_.approval] } else { $null }
  [pscustomobject]@{ source = $_.source; name = $_.name; command = $_.command; disabled = $disabled }
})

# 3) 启动文件夹（当前用户 + 所有用户）
$folders = @()
foreach ($f in @(@('user', [Environment]::GetFolderPath('Startup')), @('allUsers', [Environment]::GetFolderPath('CommonStartup')))) {
  $p = $f[1]
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
  $items = @(Get-ChildItem -LiteralPath $p -File | ForEach-Object {
    $hive = if ($f[0] -eq "user") { "HKCU" } else { "HKLM" }
    $d = $dis[$hive + "/StartupFolder/" + $_.Name]
    [pscustomobject]@{ name = $_.Name; disabled = $d }
  })
  $folders += [pscustomobject]@{ scope = $f[0]; path = $p; items = $items }
}

# 4) 自启服务（StartMode='Auto' 含延迟自启），运行中的排前面
$svc = @(Get-CimInstance Win32_Service -Filter "StartMode='Auto'" | Sort-Object State, Name | ForEach-Object {
  $p = [string]$_.PathName
  if ($p.Length -gt 140) { $p = $p.Substring(0, 140) + '...' }
  [pscustomobject]@{ name = $_.Name; display = $_.DisplayName; state = $_.State; path = $p }
})

ConvertTo-Json @{ regItems = $reg; startupFolders = $folders; services = $svc } -Depth 4
`;

async function collectStartup(): Promise<any> {
	const r = await runPwsh(STARTUP_CMD);
	if (r && typeof r.error === "string") return { error: r.error };
	const regCount = Array.isArray(r.regItems) ? r.regItems.length : 0;
	const svcCount = Array.isArray(r.services) ? r.services.length : 0;
	const disabledCount = regCount > 0 ? r.regItems.filter((x: any) => x.disabled).length : 0;
	return {
		...r,
		notice:
			collectionNotice(r) +
			`开机自启盘点（只读）。regItems=注册表 Run/RunOnce 自启项（source=所在键，含 Wow6432Node；` +
			`disabled=true 表示已在任务管理器禁用、不会开机拉起，共 ${disabledCount} 项）；` +
			`startupFolders=启动文件夹（user=当前用户，allUsers=所有用户）；` +
			`services=自启服务 StartMode=Auto（含延迟自启，共 ${svcCount} 个，Running 排前，path 超长截断）。` +
			`诊断"开机慢/启动后卡"：优先看 disabled=false 的第三方 regItems 与 Running 的非系统路径服务；` +
			`regItems.command 是实际执行的命令行，可定位到具体程序。`,
	};
}

/* ------------------------------------------------------------------ */

export default function (pi: any) {
	pi.registerTool({
		name: "startup",
		label: "Startup Audit",
		description:
			"盘点开机自启项（只读，一次调用取全）：注册表 Run/RunOnce 自启项（HKLM/HKCU/Wow6432Node，含任务管理器禁用状态）、启动文件夹（当前用户+所有用户）、自启服务列表（StartMode=Auto，含延迟自启，运行中的排前面）。用于回答'开机都拉起了什么''为什么开机慢''开机后什么在后台跑'。",
		promptSnippet:
			"Audit boot autostart entries: registry Run keys, startup folders, auto-start services (read-only)",
		promptGuidelines: [
			"Use startup when the user asks what launches at boot, what runs in the background after startup, or why booting is slow.",
			"Combine with sys scope=proc when diagnosing slowness AFTER boot: startup explains what gets launched, sys shows what is actually consuming resources now.",
		],
		parameters: Type.Object({}),

		async execute(_toolCallId: string) {
			const result: any = { startup: await collectStartup() };
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
