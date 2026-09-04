/**
 * disk - 只读磁盘信息工具（cst-pilot 定制）
 *
 * 结构只读：无任何写路径（WizTree 导出的临时 CSV 写在自家 wiztree\tmp 并即时删除）。
 * - scope=space : 纯 Node fs.statfsSync，零子进程
 * - scope=info  : 调本仓库自带的 pwsh\（命令串写死，模型输入仅作白名单校验后插值）
 * - scope=health: SMART 可靠性计数器（需管理员；失败时优雅降级并说明）
 * - scope=usage : 目录大小排行
 *     · 管理员 + WizTree 便携版可用 -> 直读 NTFS MFT（秒级全盘）
 *     · 否则 -> Node 逐文件 stat 累加（较慢；50 万条目熔断，结果为下界）
 */

import { execFile } from "node:child_process";
import { createReadStream, existsSync, promises as fsp, mkdirSync, rmSync, statfsSync } from "node:fs";
import * as readline from "node:readline";
import { promisify } from "node:util";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
// 跨扩展共享的 WizTree 账本：usage 扫描顺手喂账，ls 直接吃现成
import { addDirLine, addFileLine, driveKey } from "./wz-index";

const execFileP = promisify(execFile);

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = dirname(fileURLToPath(import.meta.url)); // .../agent/home/extensions
const ROOT_DIR = join(EXT_DIR, "..", "..", ".."); // cst-pilot 根
const PWSH = join(ROOT_DIR, "pwsh", "pwsh.exe");
const WIZTREE = join(ROOT_DIR, "wiztree", "WizTree64.exe");
const WIZTREE_TMP = join(ROOT_DIR, "wiztree", "tmp");
const DRIVE_LETTERS = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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

async function runPwsh(command: string, timeoutMs = 15000): Promise<any> {
	try {
		// encoding:"buffer" 拿原始 Buffer，自行按 UTF-8/GBK 智能解码；
		// 异步执行：pwsh 运行期间 pi 事件循环不被冻结
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
		// JSON 解析：先原样，失败再去掉控制字符后重试
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

const DISK_INFO_CMD =
	"Get-PhysicalDisk | Select-Object FriendlyName,SerialNumber,MediaType,BusType,HealthStatus,OperationalStatus,Size,DeviceId | ConvertTo-Json -Depth 3";

const VOLUME_CMD =
	"Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,DriveType,Size,FreeSpace | ConvertTo-Json -Depth 3";

// 盘符→物理盘关联（drive 过滤 info 用）：CIM 引用属性是对象，必须 ToString() 投影成字符串，
// 形态如 Win32_LogicalDisk (DeviceID = "C:") / Win32_DiskPartition (DeviceID = "Disk #1, Partition #1")
const DISK_ASSOC_CMD =
	"Get-CimInstance Win32_LogicalDiskToPartition | Select-Object @{n='Dep';e={$_.Dependent.ToString()}},@{n='Ant';e={$_.Antecedent.ToString()}} | ConvertTo-Json -Depth 3";

const SMART_CMD =
	"try { Get-PhysicalDisk -ErrorAction Stop | Get-StorageReliabilityCounter -ErrorAction Stop | Select-Object DeviceId,Wear,Temperature,PowerOnHours,ReadErrorsTotal,WriteErrorsTotal | ConvertTo-Json -Depth 3 } catch { ConvertTo-Json @{ error = ($_ | Out-String).Trim() } }";

function fmtGB(bytes?: number | null): number | null {
	return typeof bytes === "number" && bytes > 0 ? +(bytes / 2 ** 30).toFixed(1) : null;
}

/** usage 专用：GB 保留两位小数；小到两位归零的真实数据自动提升精度（绝不显示假 0） */
function fmtGB2(n: number): number {
	const gb = n / 2 ** 30;
	if (gb <= 0) return 0;
	const r2 = +gb.toFixed(2);
	if (r2 > 0) return r2;
	const r4 = +gb.toFixed(4);
	if (r4 > 0) return r4;
	return +gb.toFixed(6);
}

function diskSpace(driveFilter: string) {
	const out: any[] = [];
	for (const L of DRIVE_LETTERS) {
		if (driveFilter && !L.startsWith(driveFilter[0])) continue;
		try {
			const s = statfsSync(`${L}:/`);
			out.push({
				drive: `${L}:`,
				totalGB: +((s.blocks * s.bsize) / 2 ** 30).toFixed(1),
				freeGB: +((s.bfree * s.bsize) / 2 ** 30).toFixed(1),
				usedPct: +(100 * (1 - s.bfree / s.blocks)).toFixed(1),
			});
		} catch {
			/* 盘符不存在，跳过 */
		}
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* scope=usage · 快速路径：WizTree 直读 MFT（实测普通权限也可用）        */
/* ------------------------------------------------------------------ */

/** 僵尸文件阈值：≥50MB 且 ≥1 年未修改 */
const STALE_MIN_BYTES = 50 * 1024 * 1024;
const STALE_MIN_AGE_DAYS = 365;

/** 恒定内存的 Top-N 账本：只有超过当前末位门槛才插入并重排，
 *  其余数据流过即丢 —— 116 万行流式解析时内存不随数据量增长 */
function topKeeper<T>(n: number, key: (x: T) => number) {
	const arr: T[] = [];
	return {
		add(item: T): void {
			const k = key(item);
			if (arr.length >= n) {
				if (k <= key(arr[arr.length - 1])) return; // 快速拒绝：低于末位门槛
				arr[arr.length - 1] = item;
			} else {
				arr.push(item);
			}
			arr.sort((a, b) => key(b) - key(a));
		},
		get(): T[] {
			return arr;
		},
	};
}

/** WizTree 导出的本地时间 "YYYY/MM/DD HH:MM:SS" → Date（解析失败返回 null） */
function parseWizDate(s: string): Date | null {
	const m = s.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
	if (!m) return null;
	return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/* 卷文件系统判定：WizTree 的 MFT 捷径仅 NTFS 有效，FAT32/exFAT/UNC 上它实际走目录遍历，
 * method 必须按卷类型标注，否则 FAT32 上会冒出假的 "wiztree-mft"。结果按盘符缓存。
 * fsutil 快路径对 NTFS 系统卷可能拒绝访问（实测错误 5），失败时用 pwsh CIM 兜底。 */
const volFsCache = new Map<string, string | null>();
async function volumeFs(drive: string | null): Promise<string | null> {
	if (!drive) return null; // UNC 无盘符，保守按非 NTFS 处理
	const key = drive.toUpperCase();
	const hit = volFsCache.get(key);
	if (hit !== undefined) return hit;
	let fs: string | null = null;
	try {
		const r = await execFileP("fsutil", ["fsinfo", "volumeinfo", drive], {
			timeout: 15000,
			windowsHide: true,
			encoding: "buffer",
			maxBuffer: 1024 * 1024,
		});
		// FS 名称本身是英文，不随系统语言本地化，直接在输出里找
		const m = String(decodeBuffer(r.stdout as Buffer)).match(/(NTFS|FAT32|exFAT|FAT16|ReFS)/i);
		fs = m ? m[1].toUpperCase() : null;
	} catch {
		fs = null;
	}
	if (!fs) {
		// 兜底：CIM 查询普通权限可用（info scope 同源）
		// runPwsh 是 JSON 通道：裸字符串会解析失败被当错误，必须 ConvertTo-Json
		try {
			const r = await runPwsh(
				`(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").FileSystem | ConvertTo-Json`,
				60000,
			); // U 盘 pwsh 冷 spawn 慢，15s 会被掐
			const s = typeof r === "string" ? r : String((r as any).stdout ?? "");
			const m = s.match(/(NTFS|FAT32|exFAT|FAT16|ReFS)/i);
			fs = m ? m[1].toUpperCase() : null;
		} catch {
			fs = null;
		}
	}
	volFsCache.set(key, fs);
	return fs;
}

function usageViaWizTree(rootPath: string, topN: number): Promise<any> {
	return (async () => {
		mkdirSync(WIZTREE_TMP, { recursive: true });
		const csvPath = join(WIZTREE_TMP, "export.csv");
		try {
			// /exportfiles=1：文件行也导出 —— 大文件/扩展名/僵尸三本账的原料
			await execFileP(WIZTREE, [rootPath, "/admin=0", `/export=${csvPath}`, "/exportfolders=1", "/exportfiles=1"], {
				timeout: 180000,
				windowsHide: true,
				maxBuffer: 1024 * 1024,
			});
			if (!existsSync(csvPath)) {
				return { error: "WizTree 未生成导出文件" };
			}

			// 流式逐行解析（不依赖表头，WizTree 表头随系统语言变化）：
			// 每行 "路径",字节数,... 进聚合器后即丢，内存恒定
			const norm = (p: string) => p.replace(/[\\/]+$/, "").toUpperCase();
			const rootKey = norm(rootPath);
			const drive = driveKey(rootPath); // 有盘符才喂共享账本（UNC 路径跳过）
			const dirTop = topKeeper<{ path: string; bytes: number }>(topN, (r) => r.bytes);
			const fileTop = topKeeper<{ path: string; bytes: number }>(topN, (r) => r.bytes);
			const staleTop = topKeeper<{ path: string; bytes: number; modified: string }>(topN, (r) => r.bytes);
			const extMap = new Map<string, { bytes: number; files: number }>();
			let totalBytes = 0;
			let rows = 0;
			let files = 0;
			const now = Date.now();

			// 行格式实测：目录行 "C:\",195695...,...,2026/08/30 23:32:41,0,...（日期裸露无引号）
			// 因此：宽松行头拿路径+字节；日期从行头之后的剩余串里找（带不带引号都能吃）
			const lineRe = /^"(.+)",(\d+),/;
			const dateRe = /(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/;
			const rl = readline.createInterface({
				input: createReadStream(csvPath, { encoding: "utf-8" }),
				crlfDelay: Infinity,
			});
			for await (const line of rl) {
				const m = line.match(lineRe);
				if (!m) continue;
				const path = m[1];
				const bytes = +m[2];
				rows++;
				if (/[\\/]$/.test(path)) {
					// 目录行
					if (norm(path) === rootKey) totalBytes = bytes;
					else dirTop.add({ path, bytes });
					// 顺手喂共享账本（ls 直接吃现成，不再重复扫描）
					if (drive) addDirLine(path, bytes, drive);
					continue;
				}
				// 文件行：三本账
				files++;
				fileTop.add({ path, bytes });
				if (drive) addFileLine(path, bytes, drive); // ≥1MB 才入账（wz-index 内筛选）
				const dot = path.lastIndexOf(".");
				const ext =
					dot > path.lastIndexOf("\\") && dot < path.length - 1
						? path
								.slice(dot + 1)
								.toLowerCase()
								.slice(0, 12)
						: "(无扩展名)";
				const agg = extMap.get(ext) ?? { bytes: 0, files: 0 };
				agg.bytes += bytes;
				agg.files++;
				extMap.set(ext, agg);
				const dm = line.slice(m[0].length).match(dateRe);
				const d = dm ? parseWizDate(dm[1]) : null;
				if (d && bytes >= STALE_MIN_BYTES && now - d.getTime() >= STALE_MIN_AGE_DAYS * 86400000) {
					staleTop.add({ path, bytes, modified: dm[1] });
				}
			}
			if (rows === 0) return { error: "WizTree CSV 无数据行" };

			const fsName = await volumeFs(drive);
			const isNtfs = fsName === "NTFS";
			// 判不出 FS（探测全失败）时不瞎标，保持 wiztree-mft 仅作事实记录并提示待确认
			const fsLabel = fsName ?? "未知（探测失败）";

			const extAgg = [...extMap.entries()]
				.map(([ext, v]) => ({ ext, files: v.files, sizeGB: fmtGB2(v.bytes) }))
				.sort((a, b) => b.sizeGB - a.sizeGB)
				.slice(0, Math.min(topN, 40));

			return {
				method: isNtfs ? "wiztree-mft" : "wiztree-walk",
				root: rootPath,
				totalGB: totalBytes ? fmtGB2(totalBytes) : null,
				topDirs: dirTop.get().map((r) => ({
					path: r.path,
					sizeGB: fmtGB2(r.bytes),
					pct: totalBytes ? +((100 * r.bytes) / totalBytes).toFixed(1) : null,
				})),
				topFiles: fileTop.get().map((r) => ({
					path: r.path,
					sizeGB: fmtGB2(r.bytes),
					pct: totalBytes ? +((100 * r.bytes) / totalBytes).toFixed(1) : null,
				})),
				extAgg,
				staleFiles: staleTop.get().map((r) => ({
					path: r.path,
					sizeGB: fmtGB2(r.bytes),
					modified: r.modified,
				})),
				notice: isNtfs
					? `WizTree 全量 MFT 导出（${rows} 行，其中文件 ${files} 个）。topDirs=目录排行；topFiles=单个大文件；extAgg=按扩展名聚合（含文件数）；staleFiles=≥50MB 且 ≥1 年未修改的文件（大者优先）。全部只读统计。`
					: fsName
						? `WizTree 扫描：${fsLabel} 卷无 MFT，实际走目录遍历（${rows} 行，其中文件 ${files} 个），非 MFT 精确账。topDirs=目录排行；topFiles=单个大文件；extAgg=按扩展名聚合（含文件数）；staleFiles=≥50MB 且 ≥1 年未修改的文件（大者优先）。全部只读统计。`
						: `WizTree 扫描：卷文件系统探测失败（${rows} 行，其中文件 ${files} 个），请按 method=wiztree-walk 理解为目录遍历结果。topDirs=目录排行；topFiles=单个大文件；extAgg=按扩展名聚合（含文件数）；staleFiles=≥50MB 且 ≥1 年未修改的文件（大者优先）。全部只读统计。`,
			};
		} catch (e: any) {
			return { error: String(e?.message ?? e).slice(0, 500) };
		} finally {
			try {
				rmSync(csvPath, { force: true });
			} catch {
				/* 清理失败不影响结果 */
			}
		}
	})();
}

/* ------------------------------------------------------------------ */
/* scope=usage · 回退路径：Node 逐文件 stat 累加                       */
/* ------------------------------------------------------------------ */

const WALK_BUDGET = 500000; // stat 次数熔断

async function usageViaWalk(rootPath: string, topN: number): Promise<any> {
	const denied: string[] = [];
	const dirSizes = new Map<string, number>();
	const truncatedDirs = new Set<string>();
	let statCount = 0;
	let truncated = false;

	async function walk(dir: string): Promise<number> {
		let entries: import("node:fs").Dirent[] | undefined;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch (e: any) {
			if (denied.length < 50) denied.push(`${dir} (${e?.code ?? "ERR"})`);
			truncatedDirs.add(dir);
			return 0;
		}
		let sum = 0;
		for (const ent of entries) {
			if (statCount >= WALK_BUDGET) {
				truncated = true;
				truncatedDirs.add(dir);
				break;
			}
			if (ent.isSymbolicLink()) continue; // 防 junction/符号链接环路
			const full = join(dir, ent.name);
			if (ent.isDirectory()) {
				sum += await walk(full);
				statCount++;
			} else if (ent.isFile()) {
				try {
					const st = await fsp.stat(full);
					sum += st.size;
				} catch {
					/* 单文件不可读，忽略 */
				}
				statCount++;
			}
		}
		dirSizes.set(dir, sum);
		return sum;
	}

	const t0 = Date.now();
	const totalBytes = await walk(rootPath);
	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

	const topDirs = [...dirSizes.entries()]
		.filter(([p]) => p.replace(/[\\/]+$/, "").toUpperCase() !== rootPath.replace(/[\\/]+$/, "").toUpperCase())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([p, bytes]) => ({
			path: p,
			sizeGB: fmtGB2(bytes),
			pct: totalBytes > 0 ? +((100 * bytes) / totalBytes).toFixed(1) : null,
		}));

	return {
		method: "node-walk",
		root: rootPath,
		totalGB: fmtGB2(totalBytes),
		topDirs,
		stats: { filesScanned: statCount, elapsedSec: +elapsed, budget: WALK_BUDGET },
		truncated,
		denied: denied.length ? denied : undefined,
		notice: truncated
			? "达到扫描预算上限，提前停止：所有数值为部分统计（真实值 ≥ 显示值，下界）。可用更深的子路径分别查询。"
			: "逐文件统计完成，数值为遍历所得（系统拒绝访问的目录未计入）。",
	};
}

/* ------------------------------------------------------------------ */

export default function (pi: any) {
	pi.registerTool({
		name: "disk",
		label: "Disk Info",
		description:
			"只读磁盘信息工具，按 scope 选择子功能：space=各卷空间；info=物理盘型号/类型/健康状态；health=SMART 寿命/温度/通电小时（需管理员，权限不足自动降级）；usage=目录占用排行、单个大文件、扩展名聚合、一年未动的大文件（WizTree 快速全扫，失败自动降级为慢速统计，结果为下界）；all=space+info+health 一次取全。详细指南见 skill「disk」。",
		promptSnippet: "Query disk space, drive info, health, and directory usage ranking (read-only)",
		promptGuidelines: [
			"Use disk when the user asks about disk space, capacity, free space, drive models, drive health, or which folders take the most space.",
			"For usage ranking on large paths (whole drives), expect slower response under normal privileges; results may be lower bounds.",
		],
		parameters: Type.Object({
			scope: StringEnum(["space", "info", "health", "usage", "all"] as const),
			drive: Type.Optional(
				Type.String({ description: 'scope=space/info/health 可选，限定盘符，如 "C" 或 "C:"。省略则返回全部卷。' }),
			),
			path: Type.Optional(
				Type.String({
					description: 'scope=usage 必填。要分析的目录或盘符，如 "C:\\"、"C:\\Users"。整个目录树会被统计。',
				}),
			),
			top: Type.Optional(
				Type.Number({ description: "scope=usage 可选，返回占用最大的前 N 个目录，默认 20，上限 100。" }),
			),
		}),

		async execute(_toolCallId: string, params: { scope: string; drive?: string; path?: string; top?: number }) {
			// 参数白名单二次校验：模型只能传盘符，其余一切拒绝
			const drive = (params.drive ?? "").toUpperCase().replace(/[^A-Z]/g, "");
			if (params.drive && !/^[A-Z]$/.test(drive)) {
				return {
					content: [{ type: "text", text: `非法盘符参数: ${JSON.stringify(params.drive)}（只接受单个字母 A-Z）` }],
				};
			}

			const result: any = {};
			const scope = params.scope;

			if (scope === "space" || scope === "all") {
				result.space = diskSpace(drive);
			}

			if (scope === "info" || scope === "all") {
				const phys = await runPwsh(DISK_INFO_CMD);
				const vols = await runPwsh(VOLUME_CMD);
				let physRows: any[] = Array.isArray(phys) ? phys : [];
				let volRows: any[] = Array.isArray(vols) ? vols : [];
				if (drive && Array.isArray(phys) && Array.isArray(vols)) {
					// drive 过滤（完整版）：卷按盘符滤；物理盘按盘符→分区→物理盘关联滤
					try {
						const assoc = await runPwsh(DISK_ASSOC_CMD);
						if (!Array.isArray(assoc)) throw new Error("关联查询返回非数组");
						const diskIdx = new Set<string>();
						for (const a of assoc) {
							const dep = String(a.Dep ?? "").match(/DeviceID\s*=\s*"([A-Za-z]:)"/);
							if (!dep || dep[1].toUpperCase() !== `${drive}:`) continue;
							const d = String(a.Ant ?? "").match(/Disk #(\d+)/i);
							if (d) diskIdx.add(d[1]);
						}
						// CIM 把 DeviceId 序列化成纯数字字符串（"0"/"1"/"2"），与 Disk #N 直接对应
						physRows = physRows.filter((d: any) => diskIdx.has(String(d.DeviceId)));
						volRows = volRows.filter(
							(v: any) =>
								String(v.DeviceID ?? "")
									.replace(/[^A-Za-z]/g, "")
									.toUpperCase() === drive,
						);
					} catch (e) {
						// 关联失败不吞数据：退回全量清单并如实提示，避免队员误以为已过滤
						result.infoNotice = `盘符→物理盘关联查询失败（${String((e as any)?.message ?? e).slice(0, 120)}），info 返回全量清单未按 ${drive}: 过滤`;
					}
				}
				result.physicalDisks = Array.isArray(phys)
					? physRows.map((d: any) => ({ ...d, sizeGB: fmtGB(d.Size), Size: undefined }))
					: phys;
				result.volumes = Array.isArray(vols)
					? volRows.map((v: any) => ({
							drive: v.DeviceID,
							label: v.VolumeName,
							fs: v.FileSystem,
							driveType:
								{ 2: "Removable", 3: "Fixed", 4: "Network", 5: "Optical" }[v.DriveType as number] ??
								v.DriveType,
							totalGB: fmtGB(v.Size),
							freeGB: fmtGB(v.FreeSpace),
						}))
					: vols;
			}

			if (scope === "health" || scope === "all") {
				const smart = await runPwsh(SMART_CMD, 20000);
				if (smart && !Array.isArray(smart) && typeof smart.error === "string") {
					// 命令层失败（如权限不足）：给干净的中文说明，不带原始错误噪音
					result.smart = null;
					result.smartNotice =
						"SMART 数据需要管理员权限。当前以普通权限运行，已降级。如需寿命/温度数据，请以管理员身份重新启动 pi。";
				} else {
					result.smart = smart;
				}
			}

			if (scope === "usage") {
				const rootPath = (params.path ?? "").trim();
				if (!rootPath) {
					result.usage = { error: 'scope=usage 需要提供 path，如 "C:\\" 或 "C:\\Users\\Tim2354"' };
				} else if (!existsSync(rootPath)) {
					result.usage = { error: `路径不存在: ${rootPath}` };
				} else {
					const topN = Math.max(1, Math.min(100, Math.floor(params.top ?? 20)));
					if (existsSync(WIZTREE)) {
						// 实测普通权限也能直读 MFT：先试 WizTree，失败/异常自动降级逐文件统计
						const fast = await usageViaWizTree(rootPath, topN);
						if (fast && !fast.error) {
							result.usage = fast;
						} else {
							result.usage = await usageViaWalk(rootPath, topN);
							if (fast?.error) result.usage.degradedFrom = `wiztree: ${fast.error}`;
						}
					} else {
						result.usage = await usageViaWalk(rootPath, topN);
					}
				}
			}

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
