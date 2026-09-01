import { createAgentSession } from "@earendil-works/pi-coding-agent";

const r = await createAgentSession({
	cwd: "E:\\Learning\\Programming\\cst-pilot",
	agentDir: "E:\\Learning\\Programming\\cst-pilot\\agent\\home",
});
const sys = r.session.agent.state.tools.find((t) => t.name === "sys");
if (!sys) throw new Error("sys 工具未注册");

const cases = [
	{ scope: "sensor" },
	{ scope: "bogus" },
];
for (const p of cases) {
	console.log(`\n===== sys(${JSON.stringify(p)}) =====`);
	const t0 = Date.now();
	try {
		const out = await sys.execute("test", p, undefined, undefined, { state: {} });
		console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
		const data = JSON.parse(out.content[0].text);
		const s = data.sensor;
		if (s) {
			console.log("admin:", s.admin, "| hardware:", s.hardware?.join(" / "), "| sensorCount:", s.sensorCount);
			console.log("notice:", s.notice);
			console.log("thermalZones:", JSON.stringify(s.thermalZones));
			console.log("frequency:", JSON.stringify(s.frequency));
			console.log("sensors:", JSON.stringify(s.sensors, null, 1));
		} else {
			console.log(JSON.stringify(data, null, 1));
		}
	} catch (e) {
		console.log("抛错:", e.message);
	}
}
process.exit(0);
