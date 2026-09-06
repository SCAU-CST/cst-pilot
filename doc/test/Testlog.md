# 测试日志

方法见 [测试指南](README.md)，覆盖状态见 [Testlist](Testlist.md)。以下为历史记录的整理；本次文档重写未重新执行这些测试，也未补勾环境清单。

## 2026-09-04 · FAT32 U 盘

| 项目 | 当时记录 |
|---|---|
| 介质 | ERAZER F500 128 GB，USB 3.2，H:，FAT32 单分区 |
| 工具包 | 0.2.0，530.7 MB，包含 WizTree 残留 ini |
| 方法 | 邻接 pi 实例只调项目工具；核查者独立 PowerShell 对照 |
| 范围 | B01–B31；M01–M08 按适用性执行 |
| 总体结果 | 31 条公共调用完成，无已记录的工具崩溃或挂起；发现 3 个缺陷、1 个待查口径 |

这次记录证明该样机上的 FAT32 启动介质可完成主要调用，不代表所有 FAT32 介质或全部功能均无缺陷。原记录称数值与独立核查吻合，具体对照如下。

### 公共组结果

| 工具 | 关键返回 | 独立核查 |
|---|---|---|
| disk，7 条 | 六卷容量；WinSxS 17.50 GB；pwsh 244.7 MB | Get-Volume / Get-ChildItem 同口径对照 |
| ls，3 条 | 热缓存查询很快，跨盘隔离正常 | WinSxS 直接子项 28,281 |
| sys，5 条 | 负载、进程、GPU、传感器、IO 可返回 | 内存 32,557 MB；两条显示适配器 |
| startup，1 条 | regItems 23；disabled 三态；100 个自启服务 | HKLM Run 8 项，合计口径吻合 |
| driver，6 条 | class=Net 得 15 项；用 VEN_10EC&DEV_8125 复查命中原设备 | 0.2.0 反斜杠处理回归通过 |
| eventlog，9 条 | 八个 scope 与 detail 回查完成 | detail 的 ID、provider、recordId 一致 |

B03/B07 的 SMART 与 B30/B31 的 Security 当时走权限降级；B06/B22 参数错误明确返回。原“全过”指调用和当时判据完成，不表示管理员分支或所有真实故障样本均已验证。

### 缺陷及后续状态

| 问题 | 当时处理 | 当前说明 |
|---|---|---|
| FAT32 usage 错标 wiztree-mft | 按文件系统标注；C: 为 MFT，H: 为 walk | 保留该修复，探测失败须说明 |
| disk info 的 drive 过滤失效 | 卷与关联物理盘双过滤；本地 13/13，H: 复查仅目标卷/盘 | 2026-09-05 又修复单条结果形态等问题；关联失败仍须标明未过滤物理盘 |
| crash 误收第三方复用 ID | 当时增加 Error 过滤与 atypical，VMware 误报消失 | 当时的过滤会漏 WER；2026-09-05 改为提供程序/ID 配对，WER/Hang 不限级别 |

真实崩溃样本的跨机器复核仍不能由当时 crash total=0 代替。完整修复列表见 [审查报告](../review/2026-09-05-code-correctness.md)。

**待查口径：** proc.totalProcs=263，io.totalProcs=428，差 165；当时独立 Get-Process=450、Win32_Process=465，差 15。采样来源和时间不同，尚无记录证明该差异已解释或修复，保留为待查项。

### 移动介质差异项

| ID | 当时结果 |
|---|---|
| M01 | H: 文件量小，冷查询很快；独立遍历 22,748 文件约 810 ms |
| M02 | 在 FAT32 复现 method 错标并修复；未据此完成 exFAT 验证 |
| M03 / M05 / M07 | 不适用：非 NTFS、非机械盘、无 SD 卡 |
| M04 | 无 ≥4 GiB 文件；未覆盖支持大文件的文件系统场景 |
| M06 | 进程重启后缓存清空已验证；物理拔插未验证 |
| M08 | Agent 界面出现 ≤5 秒，完成态约 10–15 秒 |

### 样机观察与执行备注

- 48 小时查询见 WHEA-Logger/17 约 12,244 条已更正 PCIe AER，涉及 DEV_460D 根端口；当时建议继续核查端口下设备，不直接归为工具缺陷。
- rundll32 自启项中的 comain_ev2ea1.dll（119 KB）经核查签名状态为 Valid，原记录据此降低风险判断；签名有效本身不证明文件绝对安全。
- 当时观察工具包自身 CPU ≤0.5%、U 盘 IO 为 0；这是观察窗口数据，不能推广为全程负载保证。
- 分批执行耗时：disk+ls 2 分 51 秒；sys+startup 1 分 59 秒；driver 补做 1 分 23 秒；eventlog 包含 WHEA 大量记录查询。这些是交互批次时间，不等于单次工具延迟。
- driver 首轮回复因模型提供方网络超时丢失，补做后取得结果。B02 的 Agent 表述曾前后不一致，最终依据独立核查与接口语义记录缺陷。

## 2026-09-01～03 · 实现期局部验证

下列内容由原 design/tool 页面集中整理，保留日期、样机范围和关键证据，不构成当前发布验收。

| 对象 | 历史结果 |
|---|---|
| sys proc | 双采样约 1.8～1.9 秒；被放弃的 PerfProc 路径约 7.8 秒 |
| sys overview / io | 冷启动约 10 秒；热调用分别约 4 秒 / 2.8 秒 |
| sys gpu / sensor | 约 3.9 秒 / 3.6 秒；GPU 原始引擎样本曾为 452 项 |
| sensor 提权，2026-09-01 | 未装 PawnIO，admin=true；CPU 可枚举，55 个传感器中 Load 有值，Temperature/Clock/Power 为空；LHM 0.9.6 引用 PawnIO |
| sensor 限频观察 | 空闲最低约 81%，四核负载时约 90%；低值本身不能判过热 |
| driver，2026-09-03 | Win11、i5-12600KF、RTX 5070 Ti、pwsh 7.6.5；problem 0.9 秒、core 4.9 秒、external 1.0 秒、find 约 1 秒 |
| driver 枚举样本 | problem=0；net=10（过滤前 24）；蓝牙 17、音频 8、显示 2、驱动 49；external 48 + 可移动存储 1；find Net=22、Realtek=5、VID_=31 |
| driver 兼容观察 | VMware/Wintun 的 PhysicalAdapter 也为 true；DriverDate 已由 CIM 转为 DateTime；旧引号/WQL 方案曾失配，当前已改为数据编码和字面匹配 |
| eventlog，2026-09-03 | 24 小时 warn/error：117 条，约 402 ms；30 天全级别：4,218 条，约 4.5 秒 |
| eventlog 不可读记录 | System 30 天 2,934 条中出现 121 条 EventLogException，跳过后查询完成 |
| eventlog 零命中语义 | 非管理员的 Security FilterHashtable 查询曾静默零命中；事件 ID 0 有效，hcmon 曾为 386 条/30 天 |
| eventlog 留存观察 | WHEA-17 曾约 3,000 条/分钟；30 天查询的 12,272 条实际集中在约 4 分钟内，旧启停记录可能已被滚出 |
| ls / disk | ls 首次全盘建缓存样例约 12.7 秒；space <0.1 秒、info 约 3.7 秒、某小路径 usage 约 0.7 秒。均非固定时限 |

## 2026-09-05 · 代码修复局部验证

审查报告中的 22 项问题已修改；`tests/review-fixes.mjs` 的 16 组局部探针通过，覆盖参数字符串、错误传播、筛选、聚合、缓存、遍历预算和生成的 PowerShell 模板解析。本机另解析四条 PDH 计数器路径成功。

此轮没有运行中大规模测试，没有执行特殊介质或全部 Windows 10/11 版本的实机验收；不能据此将 Testlist 未勾选环境改为通过。脚本在项目既有忽略目录中，不随 Git 分发。

## 2026-09-05 · 开发机直连 · B01–B31 简单全量

- 版本/提交：`e44b9f2`（diagnostics 包重构后首个全量）
- 系统、硬件、权限：Windows 11，Maxsun i5-12600KF / RTX 5070 Ti / 32 GB / NVMe×3 + HDD×2；**非管理员**
- 启动介质与目标卷：本地仓库直连（非 U 盘）；<Sys>=C，<Vol>=E
- 执行者与模型：cst-test 工作区邻居 pi 实例（herdr wF:p2），deepseek-v4-flash @ opencode-go；核查者为本机独立 PowerShell
- 范围及未执行项目：B01–B31 全部执行，无跳项；管理员侧对照（B03 双权限、B30/B31 管理员查询）未做——本机无管理员会话
- 总耗时：Agent 侧 8 分 17 秒

| ID | 调用与关键返回 | 独立核查 | 结论 | 耗时 |
|---|---|---|---|---|
| B01 | space 全卷 7 卷 C–I，free≤total | Get-Volume 逐卷一致（C 299.1，E 79.1 free） | 通过 | <1s |
| B02 | info drive=E：volumes 仅 E:，physicalDisks 关联命中 WD SN580 | — | 通过 | 2–3s |
| B03 | health drive=C：smart 采集被拒，smartErrors 按盘留错并提示提权 | 非管理员，符合设计 | 预期降级 | ~1s |
| B04 | usage Kit top=10：wiztree-mft，四类表齐全 | — | 通过 | 3–5s |
| B05 | usage WinSxS ×2：均 17.50GB / 28281 子项，冷热同量级 | 与 09-04 基线 28281 一致 | 通过 | 8–15s |
| B06 | usage 不存在路径：明确 error | — | 通过 | <1s |
| B07 | all：space/info 完整，smart 三盘逐项报权限错误，不互相吞 | — | 通过（smart 预期降级） | 3–4s |
| B08 | ls Kit/pwsh top=15：325 子项 244.7MB，截断与 omitted 正确 | — | 通过 | ~1s |
| B09 | ls WinSxS top=10：复用 B05 缓存未重扫 | 历史基线一致 | 通过 | ~1s |
| B10 | ls E:\ top=20：18 子项 250.70GB，触发 E: 全盘建账 | — | 通过 | 20–40s |
| B11 | overview：cpu 20、mem 24457/32557、机型 Maxsun/i5-12600KF | Win32_OperatingSystem 总内存 32557MB 一致 | 通过 | ~2s |
| B12 | proc top=15：byCpu/byMem 各 15 | — | 通过 | 2–3s |
| B13 | gpu：Ti PCI + GameViewer ROOT 虚拟；gpuPct 最忙引擎不累加；nvidia 单卡读全 | Win32_VideoController 两条一致 | 通过 | ~3s |
| B14 | sensor：admin:false，LHM 6 传感器（GPU 温度/风扇/电压），CPU 核心温度不可得已声明 | — | 通过 | ~3s |
| B15 | io ×2：intervalSec≈2.07，3 盘 busy≈0–1%，byIo 有活动进程 | Get-Counter %DiskTime 3.1 同量级 | 通过 | 2–3s |
| B16 | startup：regItems 23（HKLM 8 + HKCU 15），disabled 三态，RunOnce 不套 Run 状态 | 注册表逐键计数 5+3+15+0=23 一致 | 通过 | 2–3s |
| B17 | problem：0 异常设备 + notice | ConfigManagerErrorCode≠0 计数=0 | 通过 | ~1s |
| B18 | core：net 10 / bluetooth 17 / audio 8 / display 2 / drivers 49 | 与 09-03 基线一致 | 通过 | ~4s |
| B19 | external：USBSTOR Lenovo 58.6GB + 内置 USB/屏，notice 已声明 | Win32_LogicalDisk DriveType=2 仅 H: 一致 | 通过 | ~1.5s |
| B20 | find class=Net→15；Realtek 整段 deviceId（含反斜杠）→命中 1；仅 HardwareID 子串 CC_0280→命中 1 | — | 通过 | ~1s×3 |
| B21 | find name=Realtek→5；name+class=Net→2（子集，AND 生效） | — | 通过 | ~1s×2 |
| B22 | find 无条件：明确报错 | — | 通过 | <1s |
| B23 | recent hours=48：total 12227，counts 求和=total | 独立计数 12274，差值 47 为 WHEA 持续写入的窗口漂移 | 通过 | 1–2s |
| B24 | boot kind=bluescreen：无 1001，全为 WHEA-17（n=12212），firstTime/lastTime 对应首尾 | — | 通过 | 1–2s |
| B25 | crash 总 6 条全 WER/1001（Information 级保留）；app 过滤覆盖全部分组；chrome 空 | — | 通过 | ~1s×3 |
| B26 | service：24h 无 SCM 故障，total 0 合法 | — | 通过 | ~1s |
| B27 | disk：total 0 合法空命中 | — | 通过 | ~1s |
| B28 | query ids=[41]：24h 无 Kernel-Power 41，字段齐全 | — | 通过 | ~1s |
| B29 | detail ×2：System 360946632 与 Application 174751 均命中，字段与 B23–B25 样本一致 | — | 通过 | <1s×2 |
| B30 | security：admin:false + degraded:true，未执行查询 | 非管理员，符合设计 | 预期降级 | <1s |
| B31 | security type=logonFail：先报降级，无伪造 | 非管理员，符合设计 | 预期降级 | <1s |

### 核查者对照

- 卷容量、内存总量、适配器、可移动盘、注册表 Run 计数、异常设备数与 Agent 返回逐项吻合。
- B23 计数差 47 条与 WHEA-17 持续刷屏（48h 约 1.2 万条）的窗口漂移相符，不判缺陷。

### 缺陷与待查项

1. **待查 · crash 回显只含第一组**：多组查询的 `ids`/`providers` 回显取 `specs[0]`（eventlog-core.ts `specs[0].ids`），crash 五组只回显 `ids:[1000] / providers:["Application Error"]`；事件列表、counts 与 notice 正确，但只看头部的调用者会误判查询范围。已定位代码，待修复。
2. **待查 · proc/io 进程计数差**：proc.totalProcs=291（Get-Process）vs io.totalProcs=462（Win32_Process），与 09-04 记录（263/428）同型；源码确认枚举来源不同，口径差成立，是否含漏计待独立对照。
3. **观察 · bluescreen 混入 corrected WHEA**：kind=bluescreen 白名单含 WHEA-Logger，本机全是已更正 PCIe 错误而非蓝屏，队员解读时需区分（文档已声明）。
4. **硬件观察 · WHEA-17 刷屏**：48h 内 DEV_460D 根端口 AER 更正错误约 1.2 万条，与 09-04 同型，属机器/驱动层面，不归工具问题。
5. 权限降级（SMART、security）均按设计如实转达；本轮未做管理员侧验证。

## 2026-09-06 · 0.3-B 发行树（pi 0.85.1 官方 pi.exe）· B01–B31 全量

- 版本/提交：cst-pilot 0.3.0 build7（pack.mjs 产出：861 文件 / 400.8MB，zip 159.6MB，SHA256SUMS）；pi 0.85.1 官方 SEA pi.exe；diagnostics 为 9d96593 + 本轮头部口径修复
- 系统、硬件、权限：Windows 11 24H2（26100 系），Maxsun B760M D4 / i5-12600KF / RTX 5070 Ti / 32GB；**非管理员**
- 启动介质与目标卷：F: SSD（NTFS）build7 树直跑；<Sys>=C，<Vol>=F；U 盘直跑另见 0.3-B 冒烟记录；PE/跨机未执行
- 执行者与模型：发行树内邻居 pi 实例（herdr wB:p9），deepseek-v4-flash @ opencode-go（key 随包 auth.json，PI_OFFLINE=1）；核查者为本机独立 PowerShell
- 范围及未执行项目：B01–B31 全部执行，无跳项；管理员侧变体（B03 双权限、B30/B31 管理员查询）未做——本机无管理员会话
- 总耗时：Agent 侧 12 分 29 秒（TPS 66.9 tok/s，上下文 125k/1M）
- 完整逐项报告：[2026-09-06 build7 邻居验收报告](2026-09-06-build7-report.md)

| ID | 调用与关键返回 | 独立核查 | 结论 | 耗时 |
|---|---|---|---|---|
| B01 | space：6 卷 C–H，free≤total，无 error | Get-PSDrive 逐卷一致（C+D+E≈930G、F+G≈931.5G、H=117.2G） | 通过 | ~2s |
| B02 | info F：volumes 仅 F:，970 EVO 关联命中 | — | 通过 | ~2s |
| B03 | health C：SMART 权限拒绝如实降级 | 非管理员，符合设计 | 预期降级 | ~3s |
| B04 | usage Kit：wiztree-mft 四类表齐全，pwsh 0.24G | pack 装配源 pwsh 244.7MB 同口径 | 通过 | ~10s |
| B05 | usage WinSxS 冷+热：17.5GB 两次一致 | — | 通过 | 18s/10s |
| B06 | usage 不存在路径：明确 error，无崩溃 | — | 通过 | ~1s |
| B07 | disk all：space 与 B01 逐字一致；3 物理盘容量分组自洽 | 卷总核算对一致 | 通过 | ~5s |
| B08 | ls pwsh top=15：321=15+306，omitted 99.8MB 自洽 | pwsh 244.2MB 吻合 | 通过 | ~10s |
| B09 | ls WinSxS：复用 B05 索引，跨卷不串用 | — | 通过 | ~2s |
| B10 | ls F:\：23 项 84.23GB + 下界 notice（0B 缺口见缺陷 3） | 卷占用 408.3G，下界口径如实 | 通过 | ~15s |
| B11 | overview：cpu 28%，内存 23228+9329=32557MB | Win32_OperatingSystem 31.8G/9G 一致 | 通过 | ~3s |
| B12 | proc top=15：双榜各 15，intervalSec 1.24 | Get-Process 490 进程量级合理 | 通过 | ~5s |
| B13 | gpu：adapters 与 B18 一致，gpuPct 不累加 | nvidia-smi 44°C / 11815MiB 吻合 | 通过 | ~6s |
| B14 | sensor：LHM 6 传感器结构单位正确，CPU 核温不可得有 notice | — | 通过 | ~4s |
| B15 | io ×2：intervalSec 2.14/2.1，盘映射与 B07 自洽 | — | 通过 | ~6s×2 |
| B16 | startup：services 100 + folders 1 + reg 21，disabled 三态，RunOnce 不套 Run | — | 通过 | ~8s |
| B17 | problem：0 异常 + 盲区 notice | — | 通过 | ~4s |
| B18 | core：net 10 / 蓝牙 17 / audio 8 / display 2 / drivers 46 | — | 通过 | ~8s |
| B19 | external：ERAZER U 盘 / USB WiFi / 手机共享，removable 仅 1 | H 卷 USBSTOR 对应 | 通过 | ~8s |
| B20 | find class=Net→id 子串→find id：双通道 + HardwareID 子串 + & 转义 | — | 通过 | ~4s×3 |
| B21 | find name+class：结果为子集，AND 生效 | — | 通过 | ~4s |
| B22 | find 无条件：明确提示需要条件 | — | 通过 | ~1s |
| B23 | recent 48h：12206 条，counts 求和=total | 独立 Microsoft-Windows-WHEA-Logger 计数 12206（风暴持续增长，漂移相符） | 通过 | ~6s |
| B24 | boot bluescreen：WHEA-17 全量（无 BugCheck 样本合法） | — | 通过 | ~6s |
| B25 | crash 720h：白名单内 221 条（206+12+3=total），WER Information 不漏报 | 宽口径 Id1000–1026 计 1352；差值为工具按 provider 限定的口径差 | 通过 | ~4s×3 |
| B26 | service：ids 恰 18 SCM 项不含 7045（skill 文本已更正） | — | 通过 | ~4s |
| B27 | disk 日志：10 个白名单 ID，空命中合法 | — | 通过 | ~4s |
| B28 | query ids=[41]：30 天零命中；ids=[17] 对照机制自洽 | — | 通过 | ~4s×3 |
| B29 | detail ×3：样本一致；4 分钟前样本已滚没如实报 | 风暴刷屏与独立观察一致 | 通过 | ~2s×3 |
| B30 | security：admin=false + degraded=true，未伪造 | 非管理员 | 预期降级 | ~2s |
| B31 | security logonFail：同上 | 非管理员 | 预期降级 | ~2s |

### 统计

28 通过 + 3 预期降级 + 0 失败 + 0 不适用；无崩溃、无挂起、无静默丢错。

### 缺陷与待查项

1. **已修 · 多组查询头部回显只含第一组**：`specs[0].ids` 改为全组并集（level 各组一致才回显）；修复后 --print 实测 B24 头部含 WHEA provider、B25 头部含五典型来源。Todo 第 3 条关闭。
2. **已修 · skill 文本 7045 失真**：eventlog SKILL.md service 段改为「7045 不在本通道，归 boot 白名单」。
3. **待查 · ls 卷根 0B 下界缺口**：F:\ 23 子项约 9–10 项 0B（实测 F:\图片 58.37GB），notice 已如实标注但易误读为空目录；改进项（量化缺口/标注可下钻/查明熔断路径）记 Todo。
4. **机器观察 · WHEA-17 风暴持续**：本会话内 12191→12206→12223 递增，DEV_460D PCH PCIe 根端口已更正错误约 1.2 万条/48h，与 09-04/09-05 记录同型，属机器/驱动层面。
5. 环境描述更正：邻居报告将 H 盘（外接 U 盘）写作「启动介质」，实际 kit 运行于 F 盘 build7 树，H 盘仅作为外接卷被枚举。

## 2026-09-06 · 0.3.0 发行包外部审计（Astra）与打包链路修复

- 对象：桌面版 zip（01FCAF7B...，pack.mjs 初版产出）+ 仓库 pack 链路
- 结论：**P1 属实**——pack 流程「清单→冒烟→压缩整目录」顺序缺陷，冒烟产生的 37 个 .state + 1 会话 + 空 auth.json（共 39 文件）混入 ZIP（与 build3 事故同型，本机树统计用排除口径掩盖了 ZIP 内容）；另有冒烟用真实凭据、输入无哈希锁、写探测只查存在性、说明过度承诺共 5 项
- 修复（仓库已提交 a053b0a）：副本冒烟 + 按清单打包 + tar -tf 对照 + 解压复核；smoke.mjs 本机模拟模型 + 最小 env；官方 zip/43 资源/pi.exe/扩展锁四层哈希锁 + BUILD-INFO.json；pi.cmd v10 写入探测；文档去「零写入」绝对化表述
- 新定稿：**cst-pilot-0.3.0.zip SHA256 = 4730ce22598d219e15dc2bd3a24a0507de42586be8ff59b14857ae23fc5c9b60**（857 文件，本机独立解压抽查：哈希与 AUDIT 一致、污染全 False、BUILD-INFO 完整）；完整审计报告 .audit/cst-pilot-0.3.0/AUDIT.md（不入库）
- 旧包（01FCAF7B...）作废，勿分发；原 Astra 审计的 29 项调用 + 新包 9 项复验 + 故障注入 8 项均通过（详见 AUDIT.md）
