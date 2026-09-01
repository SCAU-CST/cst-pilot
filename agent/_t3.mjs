import { createAgentSession } from "@earendil-works/pi-coding-agent";
const r = await createAgentSession({ cwd: "E:\\Learning\\Programming\\cst-pilot", agentDir: "E:\\Learning\\Programming\\cst-pilot\\agent\\home" });
const sys = r.session.agent.state.tools.find(t => t.name === "sys");
if (!sys) { console.error("sys 工具未注册！已注册:", r.session.agent.state.tools.map(t => t.name).join(", ")); process.exit(1); }
const run = async (id, params) => { const t0 = Date.now(); const res = await sys.execute(id, params); return { u: JSON.parse(res.content[0].text), ms: Date.now()-t0 }; };

// 1. proc 默认 top=10
let a = await run("a1", { scope: "proc" });
console.log(`[proc top=10] ${ (a.ms/1000).toFixed(2) }s | 进程 ${a.u.proc.totalProcs} 个 | ${a.u.proc.error ?? "OK"}`);
if (a.u.proc.byCpu) {
  console.log("  CPU Top5:");
  for (const p of a.u.proc.byCpu.slice(0, 5)) console.log(`    ${String(p.cpuPct).padStart(5)}%  ${String(p.wsMB).padStart(6)}MB  pid=${String(p.pid).padEnd(6)} ${p.name}`);
  console.log("  内存 Top3:");
  for (const p of a.u.proc.byMem.slice(0, 3)) console.log(`    ${String(p.wsMB).padStart(6)}MB  pid=${String(p.pid).padEnd(6)} ${p.name}`);
}

// 2. proc top=3 + 非法 top
let b = await run("b1", { scope: "proc", top: 3 });
console.log(`\n[proc top=3] ${ (b.ms/1000).toFixed(2) }s | byCpu=${b.u.proc.byCpu.length} byMem=${b.u.proc.byMem.length}`);

// 3. gpu
let c = await run("c1", { scope: "gpu" });
console.log(`\n[gpu top=10] ${ (c.ms/1000).toFixed(2) }s | ${c.u.gpu.error ?? "OK"}`);
if (c.u.gpu.byGpuPct) {
  console.log(`  engineSamples=${c.u.gpu.engineSamples}`);
  console.log("  GPU% Top5:");
  for (const p of c.u.gpu.byGpuPct.slice(0, 5)) console.log(`    ${String(p.gpuPct).padStart(5)}%  ${String(p.dedicatedMB ?? "-").padStart(6)}MB  pid=${String(p.pid).padEnd(6)} ${p.name ?? "(系统)"} [${p.engtypes}]`);
  console.log("  显存 Top3:");
  for (const p of c.u.gpu.byDedicatedMB.slice(0, 3)) console.log(`    ${String(p.dedicatedMB).padStart(6)}MB  pid=${String(p.pid).padEnd(6)} ${p.name ?? "(系统)"}`);
}
console.log(`  nvidia: ${JSON.stringify(c.u.gpu.nvidia)}`);

// 4. sensor（R3）
let d = await run("d1", { scope: "sensor" });
console.log(`\n[sensor] ${(d.ms/1000).toFixed(2)}s | ${d.u.sensor?.sensorCount ?? "ERR " + JSON.stringify(d.u.sensor).slice(0, 80)} 个传感器 | admin=${d.u.sensor?.admin}`);
if (d.u.sensor?.sensors?.length) {
	for (const s of d.u.sensor.sensors.slice(0, 5)) console.log(`    ${s.type}\t${s.value}\t${s.hw} · ${s.name}`);
}

// 5. 非法 scope
let e = await run("e1", { scope: "nope" });
console.log(`\n[非法 scope] ${e.u.error ?? "!!! 未报错: " + JSON.stringify(e.u).slice(0, 80)}`);

process.exit(0);
