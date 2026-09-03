# 2026-09-03

来源：eventlog 里程碑 1–9 完成（tests/_t9、_t10 直连 harness 共 148 项全过）后的收尾盘点。

1. [x] **eventlog 补 SKILL.md**：sys/disk/ls/startup 均有 `agent/home/skills/<tool>/SKILL.md`（模型侧参数与返回字段说明），eventlog 还没有。要点：8 个 scope 的字段语义、`notice` 必须转达、counts 折叠表读法（×n 与 last）、ID 白名单边界（冷门故障走 query）、与 sys 的分工（实时 vs 历史）、security 需管理员。（2026-09-03，`skills/eventlog/SKILL.md` 已建，结构比照 sys 范本：frontmatter + 参数 + 查询类公共字段 + counts 读法 + 八个 scope 逐节 + 通用约定；行为点均与 eventlog-core.ts 逐一核对——noMatch 固定码、security 降级三件套、detail 20k 封顶、unreadable 毒事件语义）
2. [x] **eventlog 真机实测**：目前仅直连 harness 验证，未做专项真机测试。要点：zip 分发形态下（随包 pwsh + 严格 PATH）的调用、工具描述/引导词在真实上下文里能否引导模型选对 scope、security 非管理员降级的真实观感、坏机器上的耗时（30s 超时是否够）、counts 折叠表在刷屏机器上的实际降噪效果。（2026-09-03 完成：邻居 fieldtest（pi.cmd zip 形态）10 轮现场问法覆盖全部 8 scope——工具选择 10/10 符合预期、参数错误 0、notice/降级转达全部如实，蓝屏问法主动质疑 6005/6006 零命中，B6 降级观感极佳（明确未执行+升级路径+旁证），B9 counts 降噪两行说完 1.3 万条，B10 五维排查表+机主收口话术。A 侧 pwsh 直连：非管理员 Security FilterHashtable 静默 0 条 vs -LogName 报 UnauthorizedAccessException（预检必要性铁证）；720h 双通道 19,201 条 5.88s，30s 超时余量 5 倍+；counts 极端折叠 12,272→1 组。测试中的重大发现：本机 WHEA/17 以约 3000 条/分钟刷屏，System 日志已被滚到只剩 4 分钟——引出覆盖面缺口，见第 5 项）
3. [ ] **driver 设备驱动排查工具的开发**：设计已定稿（`doc\design\driver_design.md`），单工具多 scope，纯 WMI/CIM、免管理员、免安装，与 sys（负载）/ disk（容量）划清边界。按设计文档里程碑顺序推进：problem（默认 + 无 scope 兜底）→ core（Net / Bluetooth / Audio / 显示）→ external（外置设备 + 可移动存储）→ find（name / class / id 过滤）→ `doc\tool\driver.md` 并同步 PRD 与 tool README。

4. [ ] **lhmGpu iGPU 真机验证**：gpu 核显降级路径（无 NVIDIA 时附 lhmGpu）已直连模拟验证（本机 N 卡下 LHM 只开 GPU），真机 iGPU 机器上未跑过。等一台带核显/无 N 卡的机器时顺带 sys gpu 确认 lhmGpu 输出与 notice 歧义消除语义。

5. [ ] **eventlog 暴露时间窗实际覆盖跨度（span）**：真机实测发现的覆盖面缺口。刷屏机器上 System 日志被单源错误滚到只剩几分钟（本机 30d 窗口 12,272 条全在 4 分钟内），但 payload 只报 total 不报窗口内最早记录时间，模型把 4 分钟的 12k 条当 30 天累计，算出误导性平均速率（实测 0.28 条/分钟 vs 真实约 3000 条/分钟）。修法：payload 加最早/最新事件时间或 notice 加一行；修完后同步 SKILL.md 公共字段节（span 两字段定义）与 eventlog.md 已知限制（判读知识归开发者文档，SKILL 不写）。
