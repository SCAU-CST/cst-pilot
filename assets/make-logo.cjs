'use strict';
/**
 * 从 branding 页眉的 ANSI Shadow 艺术字生成品牌 LOGO（PNG）。
 *
 * 字形数据与配色逻辑取自 agent/home/extensions/branding/header.ts，
 * 取定格帧：入场扫浪结束、稳态波浪相位 0（phase=0, time=Infinity）。
 * 只画艺术字与背景星点，不含页眉边框、会话信息与 tagline。
 *
 * 用法：node assets/make-logo.cjs [输出路径]
 * 默认输出 assets/logo.png（透明底）
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ============================================================ 品牌常量
// 与 header.ts 保持一致
const SHADOW_FROM = '#0d47a1';
const SHADOW_TO = '#bae6fd';
const SOLID_STOPS = [
	[0.0, '#0d47a1'], // 深湛蓝
	[0.2, '#1976d2'], // 湛蓝
	[0.6, '#38bdf8'], // 天蓝
	[1.0, '#f8fbff'], // 浅白
];
const SWEEP_MARGIN = 3;

const SPECK_DARK = 0.07;
const SPECK_TEAL = 0.12;
const SPECK_LIGHT = 0.16;

const SHADOW_GLYPHS = {
	C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
	S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
	T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
	'-': ['      ', '      ', '██████', '      ', '      ', '      '],
	P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔════╝', '██║     ', '╚═╝     '],
	I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
	L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
	O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
};

const SOLID_CHARS = new Set(['█', '▀', '▄', '▌', '▐']);
const SHADOW_CHARS = new Set(['╗', '╔', '╝', '╚', '║', '═', '╦', '╩', '╣', '╠']);

// ============================================================ 颜色工具（复刻 header.ts）
function hexToRgb(hex) {
	return [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
}

function mix(c1, c2, t) {
	const a = hexToRgb(c1);
	const b = hexToRgb(c2);
	const part = (v) => Math.round(v).toString(16).padStart(2, '0');
	return `#${part(a[0] + (b[0] - a[0]) * t)}${part(a[1] + (b[1] - a[1]) * t)}${part(a[2] + (b[2] - a[2]) * t)}`;
}

function gradSolid(t) {
	for (let i = 1; i < SOLID_STOPS.length; i++) {
		const [t0, c0] = SOLID_STOPS[i - 1];
		const [t1, c1] = SOLID_STOPS[i];
		if (t <= t1) return mix(c0, c1, (t - t0) / (t1 - t0));
	}
	return SOLID_STOPS[SOLID_STOPS.length - 1][1];
}

function cellHash(x, y, salt) {
	let h = (Math.imul(x + 17, 374761393) ^ Math.imul(y + 129, 668265263) ^ Math.imul(salt, 2246822519)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function speckledSolid(base, x, y) {
	if (cellHash(x, y, 7777) < 0.06) return '#bae6fd';
	const r = cellHash(x, y, 1337);
	if (r < SPECK_DARK) return mix(base, '#0c2f63', 0.5);
	if (r < SPECK_TEAL) return mix(base, '#0d9488', 0.35);
	if (r < SPECK_LIGHT) return mix(base, '#93c5fa', 0.35);
	return base;
}

function speckledShadow(base, x, y) {
	const r = cellHash(x, y, 4242);
	if (r < 0.06) return mix(base, '#0c4a6e', 0.35);
	return base;
}

// ============================================================ 艺术字
function buildShadowArt(text) {
	const rows = Array.from({ length: 6 }, () => '');
	for (const ch of text) {
		const glyph = SHADOW_GLYPHS[ch];
		if (!glyph) throw new Error(`no shadow glyph for ${JSON.stringify(ch)}`);
		const w = Math.max(...glyph.map((r) => r.length));
		for (let i = 0; i < 6; i++) rows[i] += `${(glyph[i] ?? '').padEnd(w)} `;
	}
	return rows.map((r) => r.slice(0, -1));
}

function padArtRows(rows) {
	const m = SWEEP_MARGIN;
	const w = rows[0].length + 2 * m;
	const blank = ' '.repeat(w);
	return [blank, ...rows.map((r) => ' '.repeat(m) + r + ' '.repeat(m)), blank];
}

// ============================================================ 画布
const CELL_W = 24; // 字符格宽（逻辑像素），宽高比 1:2，同终端字符格
const CELL_H = 48; // 字符格高；48 是 16 的整数倍，保证双线几何全部落在整数像素上
const PAD_X = 36;
const PAD_Y = 36;

const rows = padArtRows(buildShadowArt('CST-PILOT'));
const COLS = rows[0].length;
const ROWS = rows.length;
const W = COLS * CELL_W + PAD_X * 2;
const H = ROWS * CELL_H + PAD_Y * 2;

const px = Buffer.alloc(W * H * 4);

function rgb(hex) {
	return hexToRgb(hex);
}

function fillRect(x0, y0, x1, y1, c) {
	const ix0 = Math.max(0, Math.round(x0));
	const ix1 = Math.min(W, Math.round(x1));
	const iy0 = Math.max(0, Math.round(y0));
	const iy1 = Math.min(H, Math.round(y1));
	for (let y = iy0; y < iy1; y++) {
		let off = (y * W + ix0) * 4;
		for (let x = ix0; x < ix1; x++) {
			px[off] = c[0];
			px[off + 1] = c[1];
			px[off + 2] = c[2];
			px[off + 3] = 255;
			off += 4;
		}
	}
}

// 双线 box drawing：线厚 = 格高/8，双线以格中心对称分布
function drawBox(ch, gx, gy, c) {
	const t = CELL_H / 8;
	const cx = gx + CELL_W / 2;
	const cy = gy + CELL_H / 2;
	const hBands = [
		[cy - 1.5 * t, cy - 0.5 * t],
		[cy + 0.5 * t, cy + 1.5 * t],
	];
	const vBands = [
		[cx - 1.5 * t, cx - 0.5 * t],
		[cx + 0.5 * t, cx + 1.5 * t],
	];
	// 横线区间 [起点, 终点]：只为连接方向延伸
	const hSpan = {
		'═': [gx, gx + CELL_W],
		'╔': [cx - 1.5 * t, gx + CELL_W],
		'╗': [gx, cx + 1.5 * t],
		'╚': [cx - 1.5 * t, gx + CELL_W],
		'╝': [gx, cx + 1.5 * t],
	}[ch];
	const vSpan = {
		'║': [gy, gy + CELL_H],
		'╔': [cy - 1.5 * t, gy + CELL_H],
		'╗': [cy - 1.5 * t, gy + CELL_H],
		'╚': [gy, cy + 1.5 * t],
		'╝': [gy, cy + 1.5 * t],
	}[ch];
	if (hSpan) for (const [ya, yb] of hBands) fillRect(hSpan[0], ya, hSpan[1], yb, c);
	if (vSpan) for (const [xa, xb] of vBands) fillRect(xa, vSpan[0], xb, vSpan[1], c);
}

// 背景星点：空格处偶发的 *
function drawStar(gx, gy, c) {
	const cx = gx + CELL_W / 2;
	const cy = gy + CELL_H / 2;
	const arm = CELL_H * 0.2;
	const th = Math.max(2, Math.round(CELL_H * 0.08));
	fillRect(cx - arm, cy - th / 2, cx + arm, cy + th / 2, c);
	fillRect(cx - th / 2, cy - arm, cx + th / 2, cy + arm, c);
}

// ============================================================ 逐格绘制
// 背景不填色，保持全透明：置底由使用方（网页/终端）决定

for (let r = 0; r < ROWS; r++) {
	const gradRow = r - 1; // 去掉 padArtRows 加的上边一行
	const gradT = Math.min(Math.max(gradRow, 0), 5) / 5;
	const solidBase = gradSolid(gradT);
	const shadowBase = mix(SHADOW_FROM, SHADOW_TO, gradT);
	for (let x = 0; x < COLS; x++) {
		const ch = rows[r][x];
		const gx = PAD_X + x * CELL_W;
		const gy = PAD_Y + r * CELL_H;
		if (ch === ' ') {
			// 透明底上只保留亮星点；原设计的暗色微光是相对终端背景的，改为透明后没有意义
			if (cellHash(x, r, 9001) < 0.008) drawStar(gx, gy, rgb('#22d3ee'));
			continue;
		}
		if (SOLID_CHARS.has(ch)) {
			fillRect(gx, gy, gx + CELL_W, gy + CELL_H, rgb(speckledSolid(solidBase, x, r)));
			continue;
		}
		if (SHADOW_CHARS.has(ch)) {
			drawBox(ch, gx, gy, rgb(speckledShadow(shadowBase, x, r)));
			continue;
		}
		fillRect(gx, gy, gx + CELL_W, gy + CELL_H, rgb(speckledSolid(solidBase, x, r)));
	}
}

// ============================================================ PNG 编码
const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

const outPath = path.resolve(process.argv[2] || path.join(__dirname, 'logo.png'));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const png = encodePng(W, H, px);
fs.writeFileSync(outPath, png);
let opaque = 0;
for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) opaque++;
const total = W * H;
console.log(`${outPath}  ${W}x${H}  ${(png.length / 1024).toFixed(1)} KiB  不透明像素 ${((opaque / total) * 100).toFixed(1)}%`);
