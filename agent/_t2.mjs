import { createAgentSession } from "@earendil-works/pi-coding-agent";
const r = await createAgentSession({ cwd: "E:\\Learning\\Programming\\cst-pilot", agentDir: "E:\\Learning\\Programming\\cst-pilot\\agent\\home" });
const disk = r.session.agent.state.tools.find(t => t.name === "disk");
const ls = r.session.agent.state.tools.find(t => t.name === "ls");
// ① System32 二次查证：同进程内第二次应命中缓存
let t0 = Date.now(); await ls.execute("x1", { path: "C:\\Windows\\System32", top: 3 });
console.log(`[System32 第2次] ${( (Date.now()-t0)/1000 ).toFixed(2)}s`);
t0 = Date.now(); await ls.execute("x2", { path: "C:\\Windows\\System32\\DriverStore", top: 3 });
console.log(`[DriverStore]    ${((Date.now()-t0)/1000).toFixed(2)}s`);
// ② disk 四 scope
for (const scope of ["space", "info", "health"]) {
  t0 = Date.now();
  const res = await disk.execute("d"+scope, { scope, drive: "C" });
  const txt = res.content[0].text, sec = ((Date.now()-t0)/1000).toFixed(1);
  let j; try { j = JSON.parse(txt); } catch { console.log(`[${scope}] ${sec}s 非JSON: ${txt.slice(0,80)}`); continue; }
  const d = j.space ?? j.info ?? j.health ?? j;
  console.log(`[${scope}] ${sec}s | ${(txt.length/1024).toFixed(1)}KB | ${JSON.stringify(d).slice(0, 180)}`);
}
// ③ usage C 盘全盘
t0 = Date.now();
const u = await disk.execute("du", { scope: "usage", path: "C:\\", top: 6 });
const uu = JSON.parse(u.content[0].text).usage;
console.log(`\n[usage C:\\] ${((Date.now()-t0)/1000).toFixed(1)}s | method ${uu.method} | total ${uu.totalGB}GB`);
console.log(`  表规模: topDirs ${uu.topDirs?.length} / topFiles ${uu.topFiles?.length} / extAgg ${uu.extAgg?.length} / staleFiles ${uu.staleFiles?.length} | degradedFrom: ${uu.degradedFrom ?? "无"}`);
