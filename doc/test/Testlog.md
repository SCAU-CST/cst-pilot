# TestLog

测试日志。方法与清单见同目录 README.md / Testlist.md。

---

## 2026-09-04 · U 盘（H: FAT32）

**对象**：ERAZER F500 128GB，USB 3.2，FAT32 单分区；U 盘版 0.2.0（530.7MB，含 WizTree 运行残留 ini）
**方法**：交叉验证——Agent（邻居 pi 实例，只走工具）× Reviewer（本机 pwsh 自由核查）
**范围**：全量工具检测 B01–B31 + 移动介质差异项 M01–M08

### 结论

31 条全量全部执行成功，0 崩溃 0 挂起 0 幻觉。**工具链在 FAT32 移动介质上可用**：数值与 Reviewer 独立核查全部吻合，账本热路径全秒回，便携版对宿主机负载可忽略（U 盘 IO 恒 0，自身 CPU ≤0.5%）。确认缺陷 3 个、待查口径 1 个。

### 对照结果

| 工具（条数） | 结果 | Reviewer 核查 |
|---|---|---|
| disk（7） | 六卷容量、WinSxS 17.50GB、pwsh 目录 244.7MB | 与 Get-Volume / Get-ChildItem 逐项一致 |
| ls（3） | 账本热路径秒回，跨盘账本隔离正常 | WinSxS 直连子项 28281 与上轮基线一致 |
| sys（5） | 负载/进程/GPU/传感器/IO 全过 | 内存 32557MB、双适配器 bus 语义一致 |
| startup（1） | regItems 23 + 三态 disabled + 100 服务 | HKLM Run=8，合计口径吻合 |
| driver（6） | find 转义闭环通过（class=Net→15 台→VEN_10EC&DEV_8125→原设备命中） | 0.2.0 反斜杠修复回归 ✓ |
| eventlog（9） | 8 scope 全过，detail 闭环逐字段一致 | — |

权限降级全部如实：B03/B07 SMART、B30/B31 security 均正确返回 `smart:null` / `degraded:true`；错误语义 B06/B22 均明确报错不崩溃。

### 缺陷

1. ~~**FAT32 卷 method=wiztree-mft**~~ → **已修复**：usage 按 NTFS 与否标注 method（NTFS → `wiztree-mft`，否则 → `wiztree-walk`），notice 如实说明；实现与三坑记录见 [Notice.md](../Notice.md)。终验：C 盘 = wiztree-mft，U 盘 = wiztree-walk ✓
2. ~~**disk info 的 drive 参数未生效**~~ → **已修复（完整版）**：info 双过滤——卷按盘符滤，物理盘按盘符→分区→物理盘关联只留所在盘；关联失败退回全量并在 infoNotice 如实声明。直连 e2e 13/13 + 邻居终验：drive=H 只剩 U 盘与 H 卷 ✓
3. ~~**eventlog crash 白名单不区分 provider/level**~~ → **已修复（硬过滤+软标注）**：1000/1001/1002/1026 硬压 Error 级（VMware 类 Information 级复用 1000 的普通日志被滤）；命中但 provider 非典型崩溃来源的事件标 `atypical: true` 请人工判读。终验：crash total 0（VMware 误报消失）✓。真崩溃不漏报需在有真实崩溃样本的机器复核

待查：sys `proc` 报 totalProcs=263，`io` 报 428，差 165；Reviewer 当下 Get-Process 450 / Win32_Process 465（仅差 15）——两 scope 口径差异超预期。

### 数据观察（非缺陷）

- **WHEA-Logger/17 刷屏持续**：48h 12244 条"已更正"PCIe AER 错误（DEV_460D 根端口），burst 秒级百条——建议排查该端口下设备，这是本机当前最突出的健康信号
- `comain_ev2ea1.dll` 自启项（rundll32，名字像随机串）：Reviewer 核实为微软 WHQL 签名组件（119KB，Valid），低风险
- 冷账本秒回：H 盘文件数少，Reviewer 实测全盘遍历 <1s（22748 文件 810ms）——SKILL"首次建账数十秒"适用于大文件数盘
- 一次有价值的误报排查：startup 发现可疑项 → Reviewer 签名核查 → 定性低风险，交叉验证流程闭环

### 差异项（M 组）

| # | 结果 |
|---|---|
| M01 | 冷账本秒回（量级小，合理，见上） |
| M02 | FAT32 method 缺陷复现 |
| M03 / M05 / M07 | N/A（本盘非 NTFS / 非机械盘 / 无 SD 卡） |
| M04 | FAT32 4GB 上限内无 ≥4GB 文件，判据自动满足 |
| M06 | 进程级账本清空验证 ✓；物理拔插待人工配合 |
| M08 | pi 端到端启动：agent 出现 ≤5s，完成态 10–15s |

### 过程

4 批执行：disk+ls（2m51s）→ sys+startup（1m59s）→ driver（首轮回复网络超时丢失，补做 1m23s）→ eventlog（含 WHEA 万条刷屏查询）。期间重启 pane 完成 M06/M08：agent 出现 ≤5s、完成态 10–15s。过程插曲：邻居一轮回复因 provider 超时 terminated，补做后无数据损失；Agent 在 B02 上前后表述矛盾（一会称异常一会称符合预期），以 SKILL 文本为准定为缺陷。

---

*后续环境（品牌机 / Win10 政采 / PE 等）按 Testlist 逐项执行，结果追加于本文件。*
