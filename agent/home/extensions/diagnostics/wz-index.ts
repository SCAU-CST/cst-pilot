import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, promises as fsp, mkdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import * as readline from "node:readline";
import { execFileP, WIZTREE, WIZTREE_TMP } from "./runtime.ts";

/**
 * wz-index - 工具间共享的 WizTree 目录/大文件账本（进程内，不落盘）
 *
 * 两个工具共享同一份账本：
 *   - ls.ts        : 缺账时触发全盘扫描；查询走账本（同盘任意路径秒回）
 *   - disk.ts usage: 全盘扫描的流式解析顺手喂账（数据同源，零额外成本）
 *
 * 账本由统一扩展入口共享，重新加载后重建。
 *
 * 账本质量约定：只有 WizTree 完成的扫描数据才入账（node-walk 降级
 * 路径的数据是熔断下界，只返回不存储，避免污染账本）。
 */

/** 文件兜底账本只收 ≥1MB 的文件行（pagefile.sys 等假 0 / stat 失败时兜底） */
export const FILE_INDEX_MIN_BYTES = 1024 * 1024;

interface WzStore {
	/** 盘符（如 "C:"）→ 规范化目录路径 → 聚合字节 */
	dirs: Map<string, Map<string, number>>;
	/** 盘符 → 规范化文件路径 → 字节（≥1MB 的大文件） */
	files: Map<string, Map<string, number>>;
	identities: Map<string, string>;
	failed: Set<string>;
	pending: Map<string, Promise<boolean>>;
}

export const normalizePath = (p: string) =>
	resolve(p)
		.replace(/[\\/]+$/, "")
		.toUpperCase();
export function getDriveKey(p: string): string | null {
	const r = resolve(p);
	return /^[A-Za-z]:/.test(r) ? r.slice(0, 2).toUpperCase() : null;
}

export type VolumeIndex = ReturnType<typeof createVolumeIndex>;

export function createVolumeIndex() {
	/** Shared within this extension instance; /reload starts with an empty index. */
	const store: WzStore = {
		dirs: new Map(),
		files: new Map(),
		identities: new Map(),
		failed: new Set(),
		pending: new Map(),
	};

	/** Node/libuv st_dev is the Windows volume serial. Never reuse an unidentified volume. */
	async function refreshVolume(drive: string): Promise<string | null> {
		let identity: string | null = null;
		try {
			const st = await fsp.stat(`${drive}\\`, { bigint: true });
			if (st.dev !== 0n) identity = `${st.dev}:${st.birthtimeNs}`;
		} catch {
			/* Removed media or denied root: discard stale data. */
		}
		if (!identity || store.identities.get(drive) !== identity) {
			store.dirs.delete(drive);
			store.files.delete(drive);
			store.failed.delete(drive);
			store.identities.delete(drive);
			if (identity) store.identities.set(drive, identity);
		}
		return identity;
	}

	/** 规范化路径：大写、无尾分隔符 */

	/** 提取盘符键（如 "C:"）；UNC 路径返回 null（不做索引） */

	/** Publish only a completed scan of the same volume. Replace the scanned subtree atomically. */
	async function commitIndex(
		drive: string,
		identity: string,
		root: string,
		dirs: Map<string, number>,
		files: Map<string, number>,
		signal?: AbortSignal,
	): Promise<boolean> {
		signal?.throwIfAborted();
		if ((await refreshVolume(drive)) !== identity) return false;
		signal?.throwIfAborted();
		const rootKey = normalizePath(root);
		for (const [target, incoming] of [
			[store.dirs, dirs],
			[store.files, files],
		] as const) {
			const merged = new Map(target.get(drive));
			for (const key of merged.keys()) if (key === rootKey || key.startsWith(`${rootKey}\\`)) merged.delete(key);
			for (const [key, bytes] of incoming) merged.set(key, bytes);
			target.set(drive, merged);
		}
		return true;
	}

	/* ---------------- 全盘扫描建账（ls 缺账时触发） ---------------- */

	async function buildIndex(driveRoot: string, signal?: AbortSignal): Promise<boolean> {
		signal?.throwIfAborted();
		if (!existsSync(WIZTREE)) return false;
		const csvPath = join(WIZTREE_TMP, `wz-${process.pid}-${randomUUID()}.csv`);
		try {
			const drive = getDriveKey(driveRoot);
			if (!drive) return false;
			const identity = await refreshVolume(drive);
			if (!identity) return false;
			mkdirSync(WIZTREE_TMP, { recursive: true });
			await execFileP(
				WIZTREE,
				[driveRoot + sep, "/admin=0", `/export=${csvPath}`, "/exportfolders=1", "/exportfiles=1"],
				{ signal, timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 },
			);
			if (!existsSync(csvPath)) return false;
			const dirs = new Map<string, number>();
			const files = new Map<string, number>();
			const rl = readline.createInterface({
				input: createReadStream(csvPath, { signal, encoding: "utf-8" }),
				crlfDelay: Infinity,
			});
			for await (const line of rl) {
				signal?.throwIfAborted();
				const m = line.match(/^"(.+)",(\d+),/);
				if (!m) continue;
				const bytes = +m[2];
				if (/[\\/]$/.test(m[1])) {
					dirs.set(normalizePath(m[1]), bytes);
				} else {
					if (bytes >= FILE_INDEX_MIN_BYTES) files.set(normalizePath(m[1]), bytes);
				}
			}
			if (!dirs.size || (await refreshVolume(drive)) !== identity) return false;
			signal?.throwIfAborted();
			store.dirs.set(drive, dirs);
			store.files.set(drive, files);
			return true;
		} catch {
			signal?.throwIfAborted();
			return false;
		} finally {
			try {
				rmSync(csvPath, { force: true });
			} catch {
				signal?.throwIfAborted();
				/* 清理失败不影响结果 */
			}
		}
	}

	/** 建账失败过的盘（本进程内不再反复尝试，避免每次 ls 都撞一次失败） */
	const failedDrives = store.failed;

	/** ls 入口：确保目标所在盘的账本就绪（缺账则触发 WizTree 全盘扫描）。
	 *  UNC 路径 / 无 WizTree / 建账失败 → 返回空账，调用方走降级路径。 */
	async function ensureIndex(
		target: string,
		signal?: AbortSignal,
	): Promise<{
		dirs: ReadonlyMap<string, number> | null;
		files: ReadonlyMap<string, number> | null;
		drive: string | null;
	}> {
		signal?.throwIfAborted();
		const drive = getDriveKey(target);
		if (!drive) return { dirs: null, files: null, drive: null };
		const identity = await refreshVolume(drive);
		if (!identity) return { dirs: null, files: null, drive };
		if (!store.dirs.has(drive) && !failedDrives.has(drive)) {
			const key = `${drive}:${identity}`;
			let pending = store.pending.get(key);
			if (!pending) {
				pending = buildIndex(drive, signal);
				store.pending.set(key, pending);
				const task = pending;
				const clearPending = () => {
					if (store.pending.get(key) === task) store.pending.delete(key);
				};
				task.then(clearPending, clearPending);
			}
			let ok: boolean;
			try {
				ok = await new Promise<boolean>((resolve, reject) => {
					const onAbort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
					signal?.addEventListener("abort", onAbort, { once: true });
					pending.then(
						(value) => {
							signal?.removeEventListener("abort", onAbort);
							resolve(value);
						},
						(error) => {
							signal?.removeEventListener("abort", onAbort);
							reject(error);
						},
					);
					if (signal?.aborted) onAbort();
				});
			} catch (error) {
				signal?.throwIfAborted();
				if (!(error instanceof Error) || error.name !== "AbortError") throw error;
				return ensureIndex(target, signal);
			}
			if (!ok && store.identities.get(drive) === identity) failedDrives.add(drive);
		}
		signal?.throwIfAborted();
		if ((await refreshVolume(drive)) !== identity) return { dirs: null, files: null, drive };
		return { dirs: store.dirs.get(drive) ?? null, files: store.files.get(drive) ?? null, drive };
	}

	return { ensureIndex, refreshVolume, commitIndex };
}
