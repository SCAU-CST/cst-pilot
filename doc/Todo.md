# 2026-09-03

来源：sys/startup 全 scope 实测（含异源交叉验证）后的覆盖面复盘。

1. [x] **sys 新增 `io` scope**：每进程 IO 差分 + 每盘队列。现场"电脑卡"最常见原因是磁盘 IO 打满，目前 disk 管容量、sys 管负载，谁也答不了"谁在吃 IO"。（2026-09-03，`tests/_t11`：进程 IO 取 Win32_Process 累计计数差分避开 PerfProc 慢路径，每盘取 PerfDisk 格式化类双读，同窗口取全；热调 2.8s）
2. [x] **gpu scope 补核显路径**：无 N 卡时当前只报 `nvidia: null`，核显机器的 GPU 健康是真空区。LHM 用户态可读 iGPU 时钟/负载，做降级输出并消除 null 歧义。（2026-09-03，`tests/_t11`：无 NVIDIA 时附 `lhmGpu`，notice 消除歧义；LHM 精简查询直连验证 30 条传感器；iGPU 真机验证待补）
3. [x] **proc 返回项加 `path`**：数据源 Get-Process 现成字段，零开销。模型发现可疑进程后可就地验证身份，否则诊断链断裂。（2026-09-03，`tests/_t11`；null 语义已写入 notice）
4. [x] **gpu 附带适配器清单**：本机 4 适配器 3 个是虚拟显示，工具无法告知机器真实显卡型号；轻量清单可同时澄清 `nvidia: null` 的语义。（2026-09-03，`tests/_t11`：Win32_VideoController 并入 GPU_CMD，实测 <0.1s；adapters 含 name/vendor/driver/status/bus，bus=PCI/ROOT 供模型区分实体卡与虚拟显示，不硬编码谁是真卡；实测本机正确分出 RTX 5070 Ti 与 GameViewer Virtual Display）
5. [x] **overview 加内存池计数器**：nonpaged/paged pool 两行采集。“内存高但榜单无大户”（驱动泄漏）场景即可定位。（2026-09-03，`tests/_t11`：Win32_PerfFormattedData_PerfOS_Memory 即时值单读并入 OVERVIEW_CMD；实测 nonpaged 1388MB / paged 777MB；判读规则已写入 notice 与 skill）
6. [x] **gpu/sensor 计数器失败重试**：实测 GPU Engine 计数器偶发无效采样，工具收敛为 `{error}` 但无自动重试；加 1 次重试即可。另：非法参数被 schema 拦截时模型侧无明确报错文本，排障不友好，顺带评估。（2026-09-03，`tests/_t11`：collectGpu 失败重试 1 次再收敛 {error}；sensor 计数器不是机器必有，重试无判据，改为透出 counterErrors 让模型知情。schema 评估结论：pi-ai validation.js 报错含失败路径+错误说明+原始参数回显，且校验前已做宽松化转换，无需改代码）
7. [x] **overview 附带机型信息**：Win32_ComputerSystem/BIOS 现成字段（厂商/型号/BIOS 版本）+ CPU 型号。品牌机型决定已知问题清单（散热缺陷、OEM 预装坑），现场按机型匹配经验是第一步。（2026-09-03，`tests/_t11`：machine = vendor/model/cpu/physicalCores/bios/biosDate，并入 OVERVIEW_CMD；实测热调用 2.5s→约 4s，换覆盖面，已在 sys.md 限制区说明）

**真机实测（2026-09-03，herdr 邻居真实 pi 会话 fieldtest，8 轮现场问法，模型 glm-5.3-flash，约 $0.02）**：7/7 项均被真实会话验证——机型/内存池 3 次被读用（含自查两次 overview 差分判读"非分页池纹丝不动"+内存账目核对）；适配器清单 2 种问法全对（PCI/ROOT 分出真实卡与 GameViewer 虚拟卡）；proc path 当场纠正了一次进程身份幻觉（模型把 herdr.exe 瞎解释为 NVIDIA 驱动组件，path 查证后自己改口）；io 直接问法字段判读全对；gpu 三次复调无衰减。基线数据（供后续描述消融参照）：全量描述+SKILL 下工具选择 7/8 符合预期、参数错误 0、notice 转达义务执行。附带产出：真机挖出 24h 12,245 条 PCIe AER 已更正错误并给出分级处置方案——工具链设计目标的完整演练。

---

来源：eventlog 里程碑 1–9 完成（tests/_t9、_t10 直连 harness 共 148 项全过）后的收尾盘点。

1. [ ] **eventlog 补 SKILL.md**：sys/disk/ls/startup 均有 `agent/home/skills/<tool>/SKILL.md`（模型侧参数与返回字段说明），eventlog 还没有。要点：8 个 scope 的字段语义、`notice` 必须转达、counts 折叠表读法（×n 与 last）、ID 白名单边界（冷门故障走 query）、与 sys 的分工（实时 vs 历史）、security 需管理员。
2. [ ] **eventlog 真机实测**：目前仅直连 harness 验证，未做专项真机测试。要点：zip 分发形态下（随包 pwsh + 严格 PATH）的调用、工具描述/引导词在真实上下文里能否引导模型选对 scope、security 非管理员降级的真实观感、坏机器上的耗时（30s 超时是否够）、counts 折叠表在刷屏机器上的实际降噪效果。（部分证据：2026-09-03 fieldtest 真实会话中 recent/query 路径已被模型自主使用并挖出 WHEA PCIe 报错，工具选择与 notice 转达正常；但 zip 形态、坏机器耗时、counts 降噪仍待专项测）

---

来源：sys/startup 真机实测（herdr 邻居真实 pi 会话）后的发现。

1. [ ] **io 间接问法的路由竞争**：现场常见问法"电脑卡但 CPU/内存都不高，帮我查查原因"，在 eventlog 工具并存时 2 测 1 miss（模型自主选了 eventlog，且产出了高质量诊断）；直接问法（"查磁盘 IO"）稳定命中。待拍板：接受现状（模型自主路由本身有价值，eventlog 那次确实挖到了更深的病因）还是强化 sys io 的引导词/描述。后续做描述瘦身/消融时必须把这条列为观察项——删 io 引导词很可能直接丢掉这个场景的路由。
