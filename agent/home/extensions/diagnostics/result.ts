import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";

export const OUTPUT_GUIDELINE =
	"Output is limited to 50 KiB of JSON; outputTruncated means lists or text were shortened. Narrow the query to retrieve omitted data.";

/** Preserve valid JSON and signal every truncation; never cut serialized text. */
export function diagnosticResult(result: object) {
	let text = JSON.stringify(result);
	if (Buffer.byteLength(text, "utf8") > DEFAULT_MAX_BYTES) {
		const originalBytes = Buffer.byteLength(text, "utf8");
		const notice = "输出超出体积上限，列表或文本已缩短；统计总数仍对应原查询。请缩小查询范围获取省略内容。";
		let limit = 256;
		do {
			const data = limitValue(result, limit);
			text = JSON.stringify({ ...(data as object), outputTruncated: true, originalBytes, outputNotice: notice });
			limit = Math.floor(limit / 2);
		} while (Buffer.byteLength(text, "utf8") > DEFAULT_MAX_BYTES && limit > 0);
		if (Buffer.byteLength(text, "utf8") > DEFAULT_MAX_BYTES) {
			text = JSON.stringify({ outputTruncated: true, originalBytes, notice });
		}
	}
	return { content: [{ type: "text" as const, text }], details: result };
}

function limitValue(value: unknown, limit: number): unknown {
	if (typeof value === "string") return value.length > limit * 8 ? `${value.slice(0, limit * 8)}…` : value;
	if (Array.isArray(value)) return value.slice(0, limit).map((item) => limitValue(item, limit));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, limitValue(item, limit)]));
	}
	return value;
}

/** Only use for a wholly failed query; partial data stays a successful result with notices. */
export function throwOnError(result: { error?: unknown }): void {
	if (typeof result.error === "string") throw new Error(result.error);
}
