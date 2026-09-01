import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
const r = await createAgentSession({ cwd: "E:\\Learning\\Programming\\cst-pilot", agentDir: "E:\\Learning\\Programming\\cst-pilot\\agent\\home" });
const sp = r.session.agent.state.systemPrompt;
const lines = sp.split("\n");
// 打印 Available tools 与 Guidelines 两个区段
const dump = [];
let capture = false;
for (const l of lines) {
  if (/^Available tools:/.test(l)) { capture = true; }
  if (capture) dump.push(l);
  if (capture && /^## /.test(l) && dump.length > 2) { capture = false; }
}
writeFileSync("F:\\tmp\\2026-09-01\\sysprompt-sections.txt", dump.join("\n"));
// 每个工具的 LLM 可见 schema
for (const t of r.session.agent.state.tools) {
  console.log(`\n===== TOOL ${t.name} =====`);
  console.log("description:", t.description);
  console.log("parameters:", JSON.stringify(t.parameters ?? t.schema ?? null));
}
console.log("\n===== 系统提示词总长度:", sp.length, "字符 =====");
console.log(dump.join("\n"));
process.exit(0);
