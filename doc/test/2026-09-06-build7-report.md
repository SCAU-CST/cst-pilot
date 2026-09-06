# 2026-09-06 · build7 发行树邻居验收报告（B01–B31 全量，原文存档）

> 执行者：发行树内 pi 实例（deepseek-v4-flash @ opencode-go）；核查者独立 PowerShell 对照见 Testlog 同日记录。

全部 31 项执行完毕，附加核查完成。以下是验收汇总。

---

# CST Pilot 发行树公共测试组 B01–B31 验收报告

**环境**：pi 0.85.1 + 官方 pi.exe（`pi.exe` 32.0 官方版）；Windows 11 24H2（26100.9156 系列）；本机 Tim2354-PC（Maxsun B760M D4，i5-12600KF，RTX 5070 Ti）；**非管理员**运行（sensor/eventlog 均报 admin=false）；启动介质=U 盘 ERAZER F500（H:）；Kit=F:\tmp\2026-09-05\build7\cst-pilot；Sys=C；Win=C:\Windows；Vol=F。系统负载低（CPU ~28%，磁盘空闲）。

## 逐项结果

| ID | 调用 | 关键返回 | 结论 | 耗时 |
|---|---|---|---|---|
| B01 | disk space | 6 卷 C–H；free≤total 全部成立，无 0 剩余卷；无 error/notice | 通过 | ~2s |
| B02 | disk info drive=F | volumes 仅 F:；物理盘 1（Samsung 970 EVO 1TB, 931.5G, Healthy/OK）；F 为其分区，关联合理 | 通过 | ~2s |
| B03 | disk health drive=C | smartErrors「无法从客户端中访问 CIM 资源」deviceId=1 + notice 访问拒绝；未伪装数据；非管理员下属**预期降级**（管理员变体本次无法测） | 预期降级 | ~3s |
| B04 | disk usage Kit top=10 | method=wiztree-mft；四类表齐全（topDirs/topFiles/extAgg/staleFiles）；total 0.39GB；pwsh 0.24G 与 B08 的 244.2MB 同口径吻合 | 通过 | ~10s |
| B05 | usage WinSxS top=5 冷+热 | 两次均 17.5GB/240222 行，结果逐项一致；usage 确实重扫 | 通过 | 冷~18s/热~10s |
| B06 | usage 不存在路径 | 明确 error「路径不存在: Z:\…」，无崩溃挂起 | 通过 | ~1s |
| B07 | disk all | space 与 B01 **逐字一致**；physicalDisks 3（970EVO/WD SN580/ERAZER F500 USB）；容量分组核对：C+D+E≈930G、F+G≈931.5G、H=117.2G=U盘 ✓；smart=null 但逐盘 smartErrors+smartNotice+degraded=true，成功数据不被失败吞掉 | 通过 | ~5s |
| B08 | ls Kit/pwsh top=15 | 18.7→3.5MB 降序；321=15+306 截断计数吻合；omitted 99.8MB=244.2−前15项144.4 ✓；pct=7.7% 对 totalSize；unknownCount=0 | 通过 | ~10s |
| B09 | ls WinSxS top=10 | method=wiztree-index 复用 B05 索引（17.50GB、pct 同 3.5/3.5/3/2.3/2.3）；F 卷缓存未串入 C 卷；28271+10=28281、omitted 14.02G=17.50−3.48 ✓ | 通过 | ~2s |
| B10 | ls F:\ | 23 项、totalSize 84.23GB + notice 下界；0B 目录**经查证为假象**（F:\图片 实际 58.37GB，下钻正常）；下界如实标注 ✓（缺口成因见待查项3） | 通过 | ~15s |
| B11 | sys overview | cpuTotalPct=28∈[0,100]；used 23228+free 9329=32557=total 精确；机型字段齐全合理 | 通过 | ~3s |
| B12 | sys proc top=15 | byCpu/byMem 各 15 项、各自降序；intervalSec=1.24 实测；双榜进程数值交叉一致；path=null 有 notice 解释 | 通过 | ~5s |
| B13 | sys gpu | adapters 与 B18 display **完全一致**（RTX 5070 Ti 32.0.15.9186 / GameViewer 15.6.5.199）；nvidia 子块齐全（8%/45°C/11800/16303MB）；gpuPct 按最繁忙引擎不累加（SlayTheSpire2 3d=4% 而非 40%）；counterErrors=null | 通过 | ~6s |
| B14 | sys sensor | admin=false/pawnio=false；LHM 6 传感器（GPU 温43.45°/3 风扇/0.87V/结温54°）结构单位正确；thermalZone 27.9°C passivePct=100；频率 97.4/88% 无降频信号；CPU 核温不可得有 notice | 通过 | ~4s |
| B15 | sys io 冷+热 | intervalSec 2.14/2.1 实测；盘映射 0=F:G/1=C:D:E/2=H 与 B07 物理盘编号自洽；per-process 口径清楚，热调用读到自身 pwsh 活动属实时正常 | 通过 | ~6s×2 |
| B16 | startup | 三类齐全：services 100（Running 前置，含大量第三方）、startupFolders user 1 项（Snipaste disabled=true）、regItems 21 项五来源；disabled 三态 true/false/null 齐全；RunOnce 项（msedge_cleanup）=null 未套 Run 状态 ✓；Everything 等 Run+服务双通道均如实列示 | 通过 | ~8s |
| B17 | driver problem | devices=[] count=0 + 盲区 notice；成功空查询，未伪装 | 通过 | ~4s |
| B18 | driver core | net 10/蓝牙 17/audio 8/display 2/services（Audiosrv、bthserv Running）/drivers 46 条目；display 与 B13 逐字一致；connStatus 原始值 | 通过 | ~8s |
| B19 | driver external | 与 B07/B18 交叉命中：ERAZER F500 USBSTOR（对应 H 卷/物理盘2）、Realtek 8832CU USB WiFi（对应 net）、Remote NDIS #3（手机共享）；双显示器 27D1Q/P275MV PLUS；removable 仅 1 项未混入内置盘；notice 明示内置 USB/内置屏需区分 | 通过 | ~8s |
| B20 | find class=Net → id 子串 → find id | class=Net 22 项；id=SUBSYS_012310EC 双通道命中 Realtek 2.5GbE；id=CC_0280 **仅存在于 hardwareIds** 仍命中 Qualcomm；id=VEN_17CB&DEV_1103（含 &）正常匹配 | 通过 | ~4s×3 |
| B21 | find name+class | name「Bluetooth Device」2 项 → 加 class=Net 后 1 项，恰为子集，AND 生效；名称字面子串匹配 | 通过 | ~4s |
| B22 | find 无条件 | 明确提示「需要至少一个条件：name/class/id」 | 通过 | ~1s |
| B23 | eventlog recent hours=48 | 时间倒序（recordId 递减）；counts 6 组 sum=12191+6+6+1+1+1=**12206=total** ✓ countsTruncated=false；样本首尾 10:58:29~31 与 firstTime/lastTime 对应；同会话发现 WHEA 17 风暴 | 通过 | ~6s |
| B24 | boot kind=bluescreen | WHEA-Logger/17 白名单范围内（notice 明示 1001+WHEA）；24h total=12183=counts.n ✓；当日无 BugCheck 样本合法；样本首尾 10:58:46~48 对应。头部 ids 仅显示 [1001] 未含 WHEA 部分（见待查项1） | 通过 | ~6s |
| B25 | crash + crash app=clash | 24h 空命中合法；720h 221 条 counts=206+12+3=total ✓；Information 级 WER 不漏报（WindowsWcpOtherFailure3/AppHangB1/MoAppCrash 均出现）；1002 保 Error 级；app=clash 横跨 WER1001+ApplicationHang1002 两组过滤 ✓ | 通过 | ~4s×3 |
| B26 | service | ids 恰为 18 个 SCM ID，**不含 7045**，与清单「7045 属 boot」一致；24h 空命中合法；skill 文本称 7045 保留在白名单——文档待更正（待查项2） | 通过 | ~4s |
| B27 | disk 日志 | ids 恰为 skill 所列 10 个（7/11/51/129/153/55/98/50/140/157）；24h 空命中合法 | 通过 | ~4s |
| B28 | query ids=[41] System top=20 | 24h/720h 均 0——30 天无意外关机（kernel-power 41 缺失），可信；用 ids=[17] 对照验证机制：total=12187=counts ✓、truncated=true、时间倒序 ✓ | 通过 | ~4s×3 |
| B29 | detail（B23–B28 样本） | recordId=361721033（近样本）found ✓ id/provider/时间与列表一致、原文保留换行；id=1002 变体命中 B25 同款记录 174174 ✓；B23 的 361708480（4 分钟前）found=false + notice「可能已滚动清除」——因 WHEA 风暴冲刷属实，如实未找到 ✓ | 通过 | ~2s×3 |
| B30 | security | admin=false + degraded=true + notice「未执行查询」，未伪造空结果 | 预期降级 | ~2s |
| B31 | security type=logonFail | 同上，type 正确回显 | 预期降级 | ~2s |

## 统计

| 结论 | 数量 |
|---|---|
| 通过 | **28** |
| 预期降级 | **3**（B03 SMART 权限、B30、B31——均为非管理员下的明确降级，notice 如实） |
| 失败 | **0** |
| 不适用 | **0**（管理员变体 B03/B30/B31 本次未验证，已注明） |

全过程无崩溃、无挂起、无静默丢错；所有 notice/error/degraded 均如实转述。

## 缺陷与待查项

1. **eventlog 头部展示口径不一致（小）**：boot kind=bluescreen 头部 `ids:[1001]`、crash 头部 `ids:[1000] providers:["Application Error"]` 只显示主白名单对，未含 WHEA-Logger / WER 1001 / 1002 / 1026 / SideBySide 等其余分组，而 notice 中白名单描述完整（与 skill 一致）。查询结果本身正确，属头部字段与 notice 表述不一致，建议统一（头部可改为完整列表或注明「详见 notice」）。
2. **skill 文档失真（小）**：eventlog SKILL.md「service」段写「7045（新服务安装，Information 级）保留在白名单」，实际 `ids` 恰为 18 项且不含 7045，与测试清单「7045 属 boot，不能误作服务运行失败」一致——以实际行为为准，skill 文本需更正。
3. **ls 卷根下界缺口大（待查/建议）**：B10 中 F:\ 根 23 子项有 9–10 项显示 0B（图片/备份/小软件集合/数码与程序/本地资源库/VMware_share/Recovery/SVI…），而实测 F:\图片 实为 58.37GB（下钻第二个子项即正常）；totalSize 84.23GB 对卷占用约 408GB。notice 已如实标注「熔断或无权限，下界」，符合设计；但 0B 极易被误读为「空目录」，且缺口达数百 GB。建议：notice 中量化缺口（未覆盖子项数/合计）或对 0B 项标注「可下钻」；并核实卷根列出的 0B 具体走了哪条熔断路径（wz-index 账本缺失 vs walk 预算耗尽）。
4. **机器级真实发现（非工具缺陷，需转达队员）**：本机存在 **WHEA-Logger/17 PCIe Root Port 已更正确错误风暴**——近 48h 12191+ 条（B23），且会话期间持续增长（B24: 12183 → B28: 12187 → B23 同窗口 12191，各调用递增），开机（10:56）即开始；主总线 0x0:0x1:0x0，设备 `PCI\VEN_8086&DEV_460D`（12 代 PCH PCIe 根端口，可能挂 M.2/网卡/扩展槽）。风暴使 System 日志被高速冲刷（recordId 4 分钟 +12.5k，B29 一枚 4 分钟前的样本已被轮转清除）。建议队员排查：PCIe 链路设备（M.2 SSD、USB 网卡所在根端口）的 ASPM/电源管理设置、BIOS 更新、以及该端口所挂硬件是否存在接触不良。更正错误暂不致命，但如此规模值得关注。
5. **附注**：B28 ids=[41] 在 30 天窗口零命中，反证本机近 30 天无意外关机/蓝屏记录（结合 B24 无 BugCheck），机器稳定性信号良好——与上述 WHEA 风暴并存，说明是「已更正确错误」大量但未失控。

**方法学备注**：耗时为主观感知区间（本 harness 无逐调用计时器）；交叉一致性核对均以同会话内多次调用相互印证（B01/B07、B04/B08、B13/B18、B19/B07、B23/B24/B28 的 WHEA 计数）。
