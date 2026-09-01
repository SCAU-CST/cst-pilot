/**
 * wz-index - 跨扩展共享的 WizTree 目录/大文件账本（进程内，不落盘）
 *
 * 两个扩展共享同一份账本：
 *   - ls.ts        : 缺账时触发全盘扫描；查询走账本（同盘任意路径秒回）
 *   - disk.ts usage: 全盘扫描的流式解析顺手喂账（数据同源，零额外成本）
 *
 * 账本挂在 globalThis 上：pi 的扩展加载器对每个扩展文件独立编译，
 * 各文件 import 到的模块实例不保证是同一个 —— globalThis 保证进程级单例。
 *
 * 账本质量约定：只有 WizTree 全量 MFT 导出的数据才入账（node-walk 降级
 * 路径的数据是熔断下界，只返回不存储，避免污染账本）。
 */
import { existsSync, mkdirSync, createReadStream, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as readline from "node:readline";
import { join, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

const EXT_DIR = dirname(fileURLToPath(import.meta.url)); // .../agent/home/extensions
const ROOT_DIR = join(EXT_DIR, "..", "..", ".."); // cst-pilot 根
const WIZTREE = join(ROOT_DIR, "wiztree", "WizTree64.exe");
const WIZTREE_TMP = join(ROOT_DIR, "wiztree", "tmp");

/** 文件兜底账本只收 ≥1MB 的文件行（pagefile.sys 等假 0 / stat 失败时兜底） */
export const FILE_INDEX_MIN_BYTES = 1024 * 1024;

interface WzStore {
	/** 盘符（如 "C:"）→ 规范化目录路径 → 聚合字节 */
	dirs: Map<string, Map<string, number>>;
	/** 盘符 → 规范化文件路径 → 字节（≥1MB 的大文件） */
	files: Map<string, Map<string, number>>;
}

/** 进程级单例账本（globalThis 免疫扩展加载器的模块实例隔离） */
const g = globalThis as any;
const store: WzStore = (g.__wzIndexStore ??= { dirs: new Map(), files: new Map() });

/** 规范化路径：大写、无尾分隔符 */
export const normPath = (p: string) => resolve(p).replace(/[\\/]+$/, "").toUpperCase();

/** 提取盘符键（如 "C:"）；UNC 路径返回 null（不做索引） */
export function driveKey(p: string): string | null {
	const r = resolve(p);
	return /^[A-Za-z]:/.test(r) ? r.slice(0, 2).toUpperCase() : null;
}

/* ---------------- 入账（disk usage 流式解析时逐行调用） ---------------- */

export function addDirLine(rawPath: string, bytes: number, drive: string): void {
	let m = store.dirs.get(drive);
	if (!m) {
		m = new Map();
		store.dirs.set(drive, m);
	}
	m.set(normPath(rawPath), bytes);
}

export function addFileLine(rawPath: string, bytes: number, drive: string): void {
	if (bytes < FILE_INDEX_MIN_BYTES) return;
	let m = store.files.get(drive);
	if (!m) {
		m = new Map();
		store.files.set(drive, m);
	}
	m.set(normPath(rawPath), bytes);
}

/* ---------------- 查询（ls） ---------------- */

export function getIndex(drive: string): { dirs: Map<string, number> | null; files: Map<string, number> | null } {
	return {
		dirs: store.dirs.get(drive) ?? null,
		files: store.files.get(drive) ?? null,
	};
}

/* ---------------- 全盘扫描建账（ls 缺账时触发） ---------------- */

export async function buildIndex(driveRoot: string): Promise<boolean> {
	if (!existsSync(WIZTREE)) return false;
	mkdirSync(WIZTREE_TMP, { recursive: true });
	const csvPath = join(WIZTREE_TMP, "wz.csv");
	try {
		await execFileP(
			WIZTREE,
			[driveRoot + sep, "/admin=0", `/export=${csvPath}`, "/exportfolders=1", "/exportfiles=1"],
			{ timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 },
		);
		if (!existsSync(csvPath)) return false;
		const drive = driveKey(driveRoot);
		if (!drive) return false;
		const rl = readline.createInterface({
			input: createReadStream(csvPath, { encoding: "utf-8" }),
			crlfDelay: Infinity,
		});
		for await (const line of rl) {
			const m = line.match(/^"(.+)",(\d+),/);
			if (!m) continue;
			const bytes = +m[2];
			if (/[\\/]$/.test(m[1])) {
				addDirLine(m[1], bytes, drive);
			} else {
				addFileLine(m[1], bytes, drive);
			}
		}
		return true;
	} catch {
		return false;
	} finally {
		try {
			rmSync(csvPath, { force: true });
		} catch {
			/* 清理失败不影响结果 */
		}
	}
}

/** 建账失败过的盘（本进程内不再反复尝试，避免每次 ls 都撞一次失败） */
const failedDrives = new Set<string>();

/** ls 入口：确保目标所在盘的账本就绪（缺账则触发 WizTree 全盘扫描）。
 *  UNC 路径 / 无 WizTree / 建账失败 → 返回空账，调用方走降级路径。 */
export async function ensureIndex(target: string): Promise<{
	dirs: Map<string, number> | null;
	files: Map<string, number> | null;
	drive: string | null;
}> {
	const drive = driveKey(target);
	if (!drive) return { dirs: null, files: null, drive: null };
	if (!store.dirs.has(drive) && !failedDrives.has(drive)) {
		const ok = await buildIndex(drive);
		if (!ok) failedDrives.add(drive);
	}
	return { dirs: store.dirs.get(drive) ?? null, files: store.files.get(drive) ?? null, drive };
}

/** pi 会把 extensions/ 下所有 .ts 当扩展入口加载：本文件是共享模块，
 *  提供一个空 factory 让加载器安静，无任何副作用 */
export default function (): void {}
