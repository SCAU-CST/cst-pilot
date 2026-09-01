import { createAgentSession } from "@earendil-works/pi-coding-agent";
const r = await createAgentSession({ cwd: "E:\\Learning\\Programming\\cst-pilot", agentDir: "E:\\Learning\\Programming\\cst-pilot\\agent\\home" });
const get = (n) => { const t = r.session.agent.state.tools.find(t => t.name === n); if (!t) { console.error(`${n} 未注册`); process.exit(1); } return t; };
const run = async (name, params) => {
  const t0 = Date.now();
  const res = await get(name).execute("x", params);
  console.log(`\n########## ${name} ${JSON.stringify(params)} (${((Date.now()-t0)/1000).toFixed(1)}s) ##########`);
  console.log(res.content[0].text);
};
await run("ls", { path: "E:\\Learning\\Programming\\cst-pilot", top: 5 });
await run("disk", { scope: "space" });
await run("disk", { scope: "info" });
await run("disk", { scope: "health", drive: "C" });
await run("disk", { scope: "usage", path: "E:\\Learning\\Programming\\cst-pilot\\doc", top: 5 });
await run("sys", { scope: "proc", top: 3 });
await run("sys", { scope: "gpu", top: 3 });
process.exit(0);
