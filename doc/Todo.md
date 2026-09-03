# 2026-09-03

来源：sys/startup 全 scope 实测（含异源交叉验证）后的覆盖面复盘。

1. [ ] **sys 新增 `io` scope**：每进程 IO 差分 + 每盘队列。现场"电脑卡"最常见原因是磁盘 IO 打满，目前 disk 管容量、sys 管负载，谁也答不了"谁在吃 IO"。
2. [ ] **gpu scope 补核显路径**：无 N 卡时当前只报 `nvidia: null`，核显机器的 GPU 健康是真空区。LHM 用户态可读 iGPU 时钟/负载，做降级输出并消除 null 歧义。
3. [ ] **proc 返回项加 `path`**：数据源 Get-Process 现成字段，零开销。模型发现可疑进程后可就地验证身份，否则诊断链断裂。
4. [ ] **gpu 附带适配器清单**：本机 4 适配器 3 个是虚拟显示，工具无法告知机器真实显卡型号；轻量清单可同时澄清 `nvidia: null` 的语义。
5. [ ] **overview 加内存池计数器**：nonpaged/paged pool 两行采集。"内存高但榜单无大户"（驱动泄漏）场景即可定位。
6. [ ] **gpu/sensor 计数器失败重试**：实测 GPU Engine 计数器偶发无效采样，工具收敛为 `{error}` 但无自动重试；加 1 次重试即可。另：非法参数被 schema 拦截时模型侧无明确报错文本，排障不友好，顺带评估。
7. [ ] **overview 附带机型信息**：Win32_ComputerSystem/BIOS 现成字段（厂商/型号/BIOS 版本）+ CPU 型号。品牌机型决定已知问题清单（散热缺陷、OEM 预装坑），现场按机型匹配经验是第一步。

---

来源：eventlog 里程碑 1–9 完成（tests/_t9、_t10 直连 harness 共 148 项全过）后的收尾盘点。

1. [ ] **eventlog 补 SKILL.md**：sys/disk/ls/startup 均有 `agent/home/skills/<tool>/SKILL.md`（模型侧参数与返回字段说明），eventlog 还没有。要点：8 个 scope 的字段语义、`notice` 必须转达、counts 折叠表读法（×n 与 last）、ID 白名单边界（冷门故障走 query）、与 sys 的分工（实时 vs 历史）、security 需管理员。
2. [ ] **eventlog 真机实测**：目前仅直连 harness 验证，未在真实 pi 会话里端到端跑过。要点：zip 分发形态下（随包 pwsh + 严格 PATH）的调用、工具描述/引导词在真实上下文里能否引导模型选对 scope、security 非管理员降级的真实观感、坏机器上的耗时（30s 超时是否够）、counts 折叠表在刷屏机器上的实际降噪效果。
