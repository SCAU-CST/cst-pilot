# 2026-09-03

来源：eventlog 里程碑 1–9 完成（tests/_t9、_t10 直连 harness 共 148 项全过）后的收尾盘点。

1. [ ] **eventlog 补 SKILL.md**：sys/disk/ls/startup 均有 `agent/home/skills/<tool>/SKILL.md`（模型侧参数与返回字段说明），eventlog 还没有。要点：8 个 scope 的字段语义、`notice` 必须转达、counts 折叠表读法（×n 与 last）、ID 白名单边界（冷门故障走 query）、与 sys 的分工（实时 vs 历史）、security 需管理员。
2. [ ] **eventlog 真机实测**：目前仅直连 harness 验证，未做专项真机测试。要点：zip 分发形态下（随包 pwsh + 严格 PATH）的调用、工具描述/引导词在真实上下文里能否引导模型选对 scope、security 非管理员降级的真实观感、坏机器上的耗时（30s 超时是否够）、counts 折叠表在刷屏机器上的实际降噪效果。（部分证据：2026-09-03 fieldtest 真实会话中 recent/query 路径已被模型自主使用并挖出 WHEA PCIe 报错，工具选择与 notice 转达正常；但 zip 形态、坏机器耗时、counts 降噪仍待专项测）
3. [ ] **driver 设备驱动排查工具的开发**：设计已定稿（`doc\design\driver_design.md`），单工具多 scope，纯 WMI/CIM、免管理员、免安装，与 sys（负载）/ disk（容量）划清边界。按设计文档里程碑顺序推进：problem（默认 + 无 scope 兜底）→ core（Net / Bluetooth / Audio / 显示）→ external（外置设备 + 可移动存储）→ find（name / class / id 过滤）→ `doc\tool\driver.md` 并同步 PRD 与 tool README。

4. [ ] **lhmGpu iGPU 真机验证**：gpu 核显降级路径（无 NVIDIA 时附 lhmGpu）已直连模拟验证（本机 N 卡下 LHM 只开 GPU），真机 iGPU 机器上未跑过。等一台带核显/无 N 卡的机器时顺带 sys gpu 确认 lhmGpu 输出与 notice 歧义消除语义。
