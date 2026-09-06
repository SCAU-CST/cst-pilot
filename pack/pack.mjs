#!/usr/bin/env node
// ============================================================
// pack.mjs — cst-pilot 0.3-B 可复现发行构建脚本
//
// 形态：官方 pi.exe (SEA) + 本仓库内容，白名单装配，零运行态。
//
// 用法（在仓库根，用仓库自带 node 运行）：
//   node\node.exe pack\pack.mjs --official <官方zip或解压目录> --out <新目录> [--zip]
//
//   --official  官方 pi-windows-x64-<ver>.zip 或其解压目录（含 pi.exe）
//   --out       构建输出目录（新建 cst-pilot/；已存在且非空则拒绝，防覆盖）
//   --zip       装配完成后额外生成发行 zip
//
// 首次运行需联网下载 esbuild（npm 缓存），之后离线可复现。
// ============================================================

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- 构建配置（发行工程单一事实源） ----------

const CONFIG = {
  VERSION: "0.3.0",
  PI_VERSION: "0.85.1",
  ESBUILD_VERSION: "0.25.10",
  // 扩展真实版本（pi-fff 曾错标 0.1.0，修正为上游真实版本）
  EXT_VERSIONS: { "pi-fff": "0.10.6", "pi-web-access": "0.18.0", "pi-open-tui": "0.2.10" },

  // esbuild 打包的两个扩展：npm 包（源码形态）→ 预打包产物
  BUNDLE: [
    {
      name: "pi-web-access",
      entry: "agent/home/npm/node_modules/pi-web-access/index.ts",
      externals: ["@earendil-works/*", "node:*"],
    },
    {
      name: "pi-fff",
      entry: "agent/home/npm/node_modules/@ff-labs/pi-fff/src/index.ts",
      externals: ["@earendil-works/*", "node:*", "@ff-labs/*", "@sinclair/typebox"],
    },
  ],

  // pi-fff 的原生依赖链（从 npm 安装目录原样复制到 packages/pi-fff/node_modules）
  FFF_NATIVE_PACKAGES: [
    "ffi-rs",
    "@yuuang/ffi-rs-win32-x64-msvc",
    "@ff-labs/fff-bin-win32-x64",
    "@ff-labs/fff-bun",
    "@ff-labs/fff-node",
  ],

  // 官方 pi 包白名单（SEA 运行必需；裁掉 docs/examples/assets/CHANGELOG 等行李）
  OFFICIAL_ITEMS: [
    { p: "pi.exe", f: true },
    { p: "package.json", f: true },
    { p: "photon_rs_bg.wasm", f: true },
    { p: "theme", d: true },
    { p: "export-html", d: true },
    { p: "native", d: true },
    { p: "node_modules", d: true },
  ],

  // 仓库 → 发行根
  REPO_ROOT_ITEMS: [
    { p: "pi.cmd", f: true },
    { p: "README.md", f: true },
    { p: "AGENTS.md", f: true },
    { p: "biome.json", f: true },
    { p: "THIRD-PARTY-NOTICES.md", f: true },
    { p: "doc", d: true },
  ],

  // 仓库 → 发行树（带排除过滤）
  REPO_FILTERED: [
    { src: "pwsh", dst: "pwsh", exclude: ["Schemas/", "preview/", "Install-PowerShellRemoting.ps1", "RegisterManifest.ps1"] },
    { src: "wiztree", dst: "wiztree", exclude: ["WizTree3.ini", "tmp/"] },
    { src: "lhm", dst: "lhm", exclude: [] },
    { src: "agent/home/bin", dst: "agent/home/bin", exclude: [] },
    { src: "agent/home/skills", dst: "agent/home/skills", exclude: [] },
    { src: "agent/home/extensions", dst: "agent/home/extensions", exclude: [] },
  ],

  // agent/home 散文件（发行版白名单；排除运行态与开发态：npm/、sessions/、fff/、
  // auth.json、models.json、web-search.json）。**API key 不随包分发**：队员首跑在
  // pi 内 /login 填写网关凭据（写入发行树的 agent/home/auth.json，属该机的本地状态）；
  // models-store.json 仅模型目录缓存，无凭据，随包保留（离线可用模型列表）。
  REPO_HOME_FILES: ["APPEND_SYSTEM.md", "models-store.json", "open-tui.json"],

  // 发行 settings.json 生成（packages 用本地路径，不触发任何安装）
  RELEASE_SETTINGS: {
    _comment:
      "cst-pilot 0.3 发行配置：只读分析 Agent。defaultTools 仅官方结构只读两件套；六诊断工具（disk/driver/eventlog/ls/startup/sys）由 extensions/diagnostics/ 注册。defaultProjectTrust=never；skills 与上下文文件由 pi.cmd 硬关闭；packages 为本地路径扩展（离线，不安装）；enableInstallTelemetry=false 且 pi.cmd 设 PI_OFFLINE=1，无任何安装/更新遥测与启动网络操作；状态由 pi.cmd 重定向到 .state/（U 盘内）。客户机写入已审计：全新客户机零写入；若客户机已有 pwsh 的 JIT 启动优化档案（StartupProfileData-*），便携 pwsh 会更新它（pwsh 硬编码，无官方开关），除此之外零写入。",
    defaultProvider: "opencode-go",
    defaultModel: "glm-5.3-flash",
    defaultTools: ["read", "ls"],
    defaultProjectTrust: "never",
    enableInstallTelemetry: false,
    lastChangelogVersion: "0.85.1",
    packages: ["./packages/pi-fff", "./packages/pi-open-tui", "./packages/pi-web-access"],
  },
};

// ---------- 工具函数 ----------

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
let step = 0;
function banner(msg) {
  step += 1;
  console.log(`\n[${step}] ${msg}`);
}
function die(msg) {
  console.error(`\n[pack] 失败: ${msg}`);
  process.exit(1);
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) die(`${cmd} 退出码 ${r.status}${r.error ? ` (${r.error.message})` : ""}`);
}
function copyFiltered(src, dst, exclude) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s).replaceAll("\\", "/");
      if (rel === "") return true;
      return !exclude.some((x) => (x.endsWith("/") ? rel === x.slice(0, -1) || rel.startsWith(x) : rel === x));
    },
  });
}
function walk(dir, base = dir, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base, skip));
    else out.push(path.relative(base, p).replaceAll("\\", "/"));
  }
  return out;
}

// ---------- 参数 ----------

const argv = process.argv.slice(2);
function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const official = argOf("--official");
const outRoot = argOf("--out");
const wantZip = argv.includes("--zip");
if (!official || !outRoot) {
  console.error("用法: node\\node.exe pack\\pack.mjs --official <官方zip或目录> --out <新目录> [--zip]");
  process.exit(1);
}

const out = path.join(outRoot, "cst-pilot");
if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
  die(`输出目录已存在且非空，拒绝覆盖: ${out}\n      请换一个 --out 或手工清理该目录`);
}
fs.mkdirSync(out, { recursive: true });

// ---------- [1] 准备官方 pi 包 ----------

banner(`准备官方 pi 包（目标 ${CONFIG.PI_VERSION}）`);
let officialDir;
const st = fs.statSync(official);
if (st.isDirectory()) {
  officialDir = official;
  if (!fs.existsSync(path.join(officialDir, "pi.exe"))) die(`目录中无 pi.exe: ${officialDir}`);
  console.log(`使用已解压目录: ${officialDir}`);
} else {
  officialDir = path.join(outRoot, "_official");
  fs.mkdirSync(officialDir, { recursive: true });
  console.log(`解压官方 zip（bsdtar，时间戳告警无害）...`);
  run("tar.exe", ["-xf", path.resolve(official), "-C", officialDir]);
  if (!fs.existsSync(path.join(officialDir, "pi.exe"))) die(`zip 解压后无 pi.exe: ${officialDir}`);
}
const officialVersion = JSON.parse(fs.readFileSync(path.join(officialDir, "package.json"), "utf8")).version;
if (officialVersion !== CONFIG.PI_VERSION) {
  die(`官方包版本 ${officialVersion} ≠ 配置版本 ${CONFIG.PI_VERSION}；请更新 pack.mjs 的 PI_VERSION 并走全量验收`);
}

// ---------- [2] esbuild 预打包扩展 ----------

banner("esbuild 预打包扩展（web-access、fff）");
const npxCli = path.join(repoRoot, "node", "node_modules", "npm", "bin", "npx-cli.js");
if (!fs.existsSync(npxCli)) die(`未找到 npm 入口: ${npxCli}`);
const packagesDir = path.join(out, "agent", "home", "packages");
fs.mkdirSync(packagesDir, { recursive: true });
for (const b of CONFIG.BUNDLE) {
  const entry = path.join(repoRoot, b.entry);
  if (!fs.existsSync(entry)) die(`扩展入口不存在: ${entry}`);
  const outdir = path.join(packagesDir, b.name);
  fs.mkdirSync(outdir, { recursive: true });
  const externals = b.externals.flatMap((e) => ["--external:" + e]);
  run(process.execPath, [
    npxCli, "-y", `esbuild@${CONFIG.ESBUILD_VERSION}`,
    "--bundle", entry, "--format=esm", "--platform=node", "--target=node20",
    "--splitting", `--outdir=${outdir}`, ...externals,
  ]);
  console.log(`  ${b.name}: ${fs.readdirSync(outdir).length} 个产物文件`);
}

// pi-fff 原生依赖链（.node 不可内联，原样复制）
const fffNm = path.join(packagesDir, "pi-fff", "node_modules");
fs.mkdirSync(fffNm, { recursive: true });
for (const p of CONFIG.FFF_NATIVE_PACKAGES) {
  const src = path.join(repoRoot, "agent", "home", "npm", "node_modules", p);
  if (!fs.existsSync(src)) die(`fff 依赖缺失（先在开发环境安装）: ${src}`);
  fs.cpSync(src, path.join(fffNm, p), { recursive: true });
}
console.log(`  pi-fff 原生链: ${CONFIG.FFF_NATIVE_PACKAGES.length} 个包`);

// pi-open-tui 零依赖，整包原样
fs.cpSync(
  path.join(repoRoot, "agent", "home", "npm", "node_modules", "pi-open-tui"),
  path.join(packagesDir, "pi-open-tui"),
  { recursive: true },
);
// 扩展包装 package.json（pi.extensions 指向 bundle 入口；版本用真实版本）
for (const name of ["pi-fff", "pi-web-access"]) {
  fs.writeFileSync(
    path.join(packagesDir, name, "package.json"),
    JSON.stringify({ name, version: CONFIG.EXT_VERSIONS[name], type: "module", pi: { extensions: ["./index.js"] } }),
  );
}

// ---------- [3] 白名单装配 ----------

banner("白名单装配（官方 + 仓库 + 生成）");
for (const it of CONFIG.OFFICIAL_ITEMS) {
  const src = path.join(officialDir, it.p);
  if (!fs.existsSync(src)) die(`官方包缺少 ${it.p}（官方布局变更？）`);
  const dst = path.join(out, it.p);
  it.f ? fs.copyFileSync(src, dst) : fs.cpSync(src, dst, { recursive: true });
}
console.log("  官方侧: pi.exe + 6 组运行资源");

for (const it of CONFIG.REPO_ROOT_ITEMS) {
  const src = path.join(repoRoot, it.p);
  if (!fs.existsSync(src)) die(`仓库缺少 ${it.p}`);
  const dst = path.join(out, it.p);
  it.f ? fs.copyFileSync(src, dst) : fs.cpSync(src, dst, { recursive: true });
}
for (const it of CONFIG.REPO_FILTERED) {
  const src = path.join(repoRoot, it.src);
  if (!fs.existsSync(src)) die(`仓库缺少 ${it.src}`);
  copyFiltered(src, path.join(out, it.dst), it.exclude);
}
for (const f of CONFIG.REPO_HOME_FILES) {
  const src = path.join(repoRoot, "agent", "home", f);
  if (!fs.existsSync(src)) die(`仓库缺少 agent/home/${f}`);
  fs.copyFileSync(src, path.join(out, "agent", "home", f));
}
console.log("  仓库侧: pi.cmd/文档/pwsh/wiztree/lhm/home 资源");

// ---------- [4] 发行 settings.json ----------

banner("生成发行 settings.json（本地路径扩展 + 遥测关闭）");
fs.writeFileSync(path.join(out, "agent", "home", "settings.json"), JSON.stringify(CONFIG.RELEASE_SETTINGS, null, 2) + "\n");

// ---------- [5] VERSION + SHA256SUMS ----------

banner("生成 VERSION 与 SHA256SUMS");
fs.writeFileSync(path.join(out, "VERSION"), `cst-pilot ${CONFIG.VERSION}\npi ${CONFIG.PI_VERSION}\n`);
const files = walk(out);
const sums = files.map((rel) => {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(path.join(out, rel)));
  return `${h.digest("hex")}  ${rel}`;
});
fs.writeFileSync(path.join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`  VERSION: cst-pilot ${CONFIG.VERSION} / pi ${CONFIG.PI_VERSION}`);
console.log(`  SHA256SUMS: ${files.length} 个文件`);

// ---------- [6] 打包后自动冒烟 ----------

banner("打包后冒烟（发行树 pi.cmd --print，PI_OFFLINE 不影响模型调用）");
const smoke = spawnSync("cmd.exe", ["/c", path.join(out, "pi.cmd"), "--print", "只回复ok"], {
  cwd: out,
  encoding: "utf8",
  timeout: 300000,
});
if (smoke.error || smoke.status !== 0) {
  die(`冒烟失败: ${smoke.error?.message ?? `退出码 ${smoke.status}`}\n${smoke.stderr ?? ""}`);
}
const smokeOut = (smoke.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
if (!smokeOut.includes("ok")) die(`冒烟输出异常: ${smokeOut}`);
console.log(`  冒烟通过，输出: ${smokeOut}`);

// ---------- [7] 统计（排除冒烟产生的运行态） ----------

banner("统计发行树（排除 .state 与 home 运行态）");
const SKIP = [".state"];
const releaseFiles = walk(out, out, SKIP).filter(
  (rel) =>
    !rel.startsWith("agent/home/sessions/") &&
    !rel.startsWith("agent/home/fff/") &&
    rel !== "agent/home/auth.json",
);
let bytes = 0;
for (const rel of releaseFiles) bytes += fs.statSync(path.join(out, rel)).size;
console.log(`  发行树: ${releaseFiles.length} 个文件 / ${(bytes / 1024 / 1024).toFixed(1)} MB（不含运行态）`);

// ---------- [8] 可选 zip ----------

if (wantZip) {
  banner("生成发行 zip");
  const zipPath = path.join(outRoot, `cst-pilot-${CONFIG.VERSION}.zip`);
  run("tar.exe", ["-a", "-c", "-f", zipPath, "-C", outRoot, "cst-pilot"]);
  const z = fs.statSync(zipPath);
  console.log(`  zip: ${(z.size / 1024 / 1024).toFixed(1)} MB → ${zipPath}`);
}

console.log(`\n[pack] 完成: ${out}`);
