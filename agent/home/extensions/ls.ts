/**
 * ls - 自定义目录浏览工具（覆盖 pi 内置 ls）
 *
 * pi 内置 ls 的先天缺陷：stat 拿到了文件大小却在输出时丢弃。
 * 本工具以同名覆盖内置（pi 的 toolRegistry 中扩展工具后注册即覆盖内置同名工具）：
 *   - 列出目录的【直接子项】（文件 + 子文件夹），按占用大小倒序
 *   - 文件给字节；文件夹给递归聚合大小
 *   - 附各子项占父目录的百分比
 *   - 默认截断最大的前 20 项，并报告被截掉的数量与合计（模型不丢失全貌感）
 *
 * 大小引擎（只读，账本与 disk usage 共享，见 wz-index.ts）：
 *   1) WizTree 存在 -> 全盘 MFT 导出一次（或直接吃 disk usage 扫描喂的现成账），
 *      进程内共享缓存，之后同盘任意路径秒回
 *   2) 无 WizTree / 建账失败 -> 逐文件递归累计（50 万条目熔断，标注"下界"）
 *
 * 文件兜底：pagefile.sys 等系统独占文件 statSync 返回假 0，用 MFT 文件行兜底。
 * 结构只读：临时 CSV 写自家 wiztree\tmp 并即时删除。
 */

import { existsSync, promises as fsp, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { ensureIndex, normPath } from "./wz-index";

const TOP_DEFAULT = 20;
const TOP_MAX = 50;
const WALK_BUDGET = 500000; // 递归熔断：最多 stat 的文件数
const WALK_TIMEOUT_MS = 30000; // 递归熔断：总时长

/* ---------------- 大小格式化 ---------------- */

function fmtSize(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}

/* ---------------- 降级路径：递归累计 ---------------- */

async function walkSize(
	dir: string,
	budget: { files: number; deadline: number },
): Promise<{ bytes: number; complete: boolean }> {
	let bytes = 0;
	let complete = true;
	let entries: import("node:fs").Dirent[] | undefined;
	try {
		entries = await fsp.readdir(dir, { withFileTypes: true });
	} catch {
		return { bytes: 0, complete: false };
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		try {
			if (e.isDirectory()) {
				// 跳过符号链接/junction 目录，避免环
				if (e.isSymbolicLink()) continue;
				const sub = await walkSize(full, budget);
				bytes += sub.bytes;
				complete = complete && sub.complete;
			} else {
				if (budget.files++ >= WALK_BUDGET || Date.now() > budget.deadline) {
					complete = false;
					continue;
				}
				bytes += (await fsp.stat(full)).size;
			}
		} catch {
			complete = false;
		}
	}
	return { bytes, complete };
}

/* ---------------- 工具定义 ---------------- */

export default function (pi: any) {
	pi.registerTool({
		name: "ls",
		label: "LS",
		description:
			"列出目录的直接子项（文件和子文件夹），按占用大小从大到小排序，默认返回最大的前 20 项。" +
			"文件显示字节大小，子文件夹显示递归聚合大小，每项附带占父目录的百分比。" +
			"若被截断，会报告剩余项数与合计。用于浏览任意目录的内容与体积分布。",
		promptSnippet: "List directory contents with sizes and percentages (read-only)",
		promptGuidelines: [
			"Use ls to browse a directory's size distribution; use disk scope=usage for full-tree analysis of large paths.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "要浏览的目录路径" }),
			top: Type.Optional(Type.Number({ description: `返回前 N 项（默认 ${TOP_DEFAULT}，最大 ${TOP_MAX}）` })),
		}),
		async execute(_id: string, params: { path: string; top?: number }) {
			const target = resolve(params.path);
			const top = Math.max(1, Math.min(TOP_MAX, Math.floor(params.top ?? TOP_DEFAULT)));
			if (!existsSync(target)) {
				return { content: [{ type: "text", text: JSON.stringify({ error: `路径不存在: ${target}` }) }] };
			}
			let st: import("node:fs").Stats | undefined;
			try {
				st = statSync(target);
			} catch (e: any) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `无法读取: ${String(e?.message ?? e)}` }) }],
				};
			}
			if (!st.isDirectory()) {
				return { content: [{ type: "text", text: JSON.stringify({ error: `不是目录: ${target}` }) }] };
			}

			let names: string[];
			try {
				names = readdirSync(target);
			} catch (e: any) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `无法列出: ${String(e?.message ?? e)}` }) }],
				};
			}

			const { dirs, files } = await ensureIndex(target);
			let incomplete = false;
			const items: { name: string; type: "file" | "dir"; bytes: number }[] = [];
			const budget = { files: 0, deadline: Date.now() + WALK_TIMEOUT_MS };

			for (const name of names) {
				const full = join(target, name);
				const key = normPath(full);
				try {
					const s = statSync(full);
					if (s.isDirectory()) {
						const cached = dirs?.get(key);
						if (cached !== undefined) {
							items.push({ name, type: "dir", bytes: cached });
						} else {
							const r = await walkSize(full, budget);
							items.push({ name, type: "dir", bytes: r.bytes });
							if (!r.complete) incomplete = true;
						}
					} else {
						// statSync 对 pagefile.sys 等系统独占文件返回假 0，用 MFT 文件行兜底
						const bytes = s.size > 0 ? s.size : (files?.get(key) ?? 0);
						items.push({ name, type: "file", bytes });
					}
				} catch {
					// stat 失败（权限/锁定）：先异步补 stat，仍失败则查账本兜底，都查不到记 0
					const s = await fsp.stat(full).catch(() => null);
					if (s?.isDirectory()) {
						const cached = dirs?.get(key);
						items.push({ name, type: "dir", bytes: cached ?? 0 });
					} else {
						items.push({ name, type: "file", bytes: files?.get(key) ?? 0 });
					}
					if (s?.isDirectory() && dirs?.get(key) === undefined) incomplete = true;
				}
			}

			items.sort((a, b) => b.bytes - a.bytes);
			const totalBytes = items.reduce((sum, i) => sum + i.bytes, 0);
			const truncated = items.length > top;
			const kept = items.slice(0, top);
			const omitted = items.slice(top);
			const omittedBytes = omitted.reduce((sum, i) => sum + i.bytes, 0);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							path: target,
							totalChildren: items.length,
							totalSize: fmtSize(totalBytes),
							method: dirs ? "wiztree-index" : "walk",
							entries: kept.map((i) => ({
								name: i.name,
								type: i.type,
								size: fmtSize(i.bytes),
								bytes: i.bytes,
								pct: totalBytes > 0 ? +((100 * i.bytes) / totalBytes).toFixed(1) : null,
							})),
							...(truncated
								? {
										omitted: {
											count: omitted.length,
											size: fmtSize(omittedBytes),
											note: "已按大小截断，其余为小项",
										},
									}
								: {}),
							...(incomplete ? { notice: "部分子项大小未统计完整（熔断或无权限），所示大小为下界" } : {}),
						}),
					},
				],
			};
		},
	});
}
