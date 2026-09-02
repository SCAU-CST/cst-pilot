# Design — driver 设备驱动排查工具

对应 `doc\PRD.md`。定位：**全面诊断矩阵的设备驱动维度**——
排查「蓝牙/网卡/声卡驱动出问题了吗、出在哪个设备上」，
以及「插入的 USB 设备（U盘 / 手机 / 打印机…）认没认出来」。

## TLDR

`driver`：只读的设备与驱动健康盘点。单工具多 scope，
沿用 sys / startup 已验证的模式；调用方是模型，一份描述、
一套返回结构（`data / notice / error`）。

与 sys 边界一句话：sys 管"负载"（设备活着但忙），
driver 管"健康"（设备活着吗、驱动对不对）。
与 disk 边界一句话：盘上容量归 disk，设备与驱动归 driver。

## 选型

A 单工具多 scope / B 每类设备一工具 / C 全量快照 → **A**。

- 三类排查（异常设备 / 关键硬件 / 插入设备）同源同构，
  都是 PnP 枚举的不同过滤，拆开白烧 3 份描述
- C 把最贵路径（SignedDriver 全枚举）绑死在每次调用
- 全量驱动版本管理（更新/卸载/回滚）不在定位内——
  那是安装侧，原则突破，见「边界」

## 接口

```
driver({ scope? })
│
├─ problem    异常设备排查（默认）—— 无 scope 兜底
│             Status=Error/Unknown 的 PnP 设备
│             + 硬件 ID（VEN/DEV）+ 错误码人话解读
│
├─ core       常见硬件现状快照
│             Net（物理网卡，区分虚拟）/ Bluetooth（设备 + bthserv 服务）
│             / Audio / 显示（显卡驱动版本）
│
└─ usb        插入设备排查
              USB 总线在线设备：名称 / 类 / 驱动状态 / 硬件 ID
              + 可移动存储（U盘 / 移动硬盘）
```

三类排查覆盖的典型工单：

- 「蓝牙不见了」→ problem 空则看 core（多半是服务停了或设备被禁用）
- 「上不了网」→ core 的 Net 区分驱动缺失 vs 媒体断开 vs 虚拟网卡干扰
- 「U盘 / 手机认不出来」→ usb 看设备在不在枚举里、驱动状态如何

## 架构

外部缝一条，复杂度全在实现内：

```
┌──────────────────────────────────────────┐
│ 接口：driver { scope }                    │
├──────────────────────────────────────────┤
│ driver.ts 路由 + 参数校验 + 结果包装        │
│  ├─ collectProblem()  Error/Unknown 合并   │
│  ├─ collectCore()     按类查询 + 服务状态    │
│  ├─ collectUsb()      USB 总线过滤          │
│  └─ runPwsh / 超时 / 解析   ← 共享设施       │
└──────────────────────────────────────────┘
```

`collectX()` 仅供实现与直连 harness（`_t*.mjs`）测试。

## 采集要点

- problem：`Get-PnpDevice` 按 Status 过滤，**Error 与 Unknown 合并**
  —— 单用 `ConfigManagerErrorCode != 0` 会漏个别未知设备
  （指纹识别器实例，Stack Overflow 有案）；附错误码对照表（28=未装驱动…）
  与硬件 ID（`DEVPKEY_Device_HardwareIds`），模型可凭 ID 定位设备型号
- core：Net 用 `Win32_NetworkAdapter` 的 `PhysicalAdapter` 剔除虚拟网卡
  （Hyper-V / VPN / 虚拟显示器），`NetConnectionStatus` 区分
  「媒体断开」与「驱动问题」；Bluetooth 附 `bthserv` 服务状态
  ——蓝牙「消失」最常见原因是服务停止或设备被禁用，只查 PnP 会漏诊；
  显示复用 `Win32_VideoController`（sys gpu scope 同源）
- usb：PnP 设备按 `DeviceID` 前缀 `USB\` 过滤，附可移动存储
  （`Win32_DiskDrive` 的 USB 接口项）；手机 MTP 属 WPD 类，一并纳入
- 全部查询免管理员、免安装（纯 WMI/CIM）

## 确定性

排查的输入空间全部封闭，工具层 ≈ 6 条固定命令 + 2 张写死的表，
输出是机器状态的纯函数（同状态同输出，无随机分支）：

| 层 | 封闭性依据 |
|---|---|
| 命令集 | 6 个 WMI/CIM 类，微软文档化 |
| 问题码 | CM_PROB 1–57 全集，`cfg.h` 定义，MS Learn 完整文档 |
| 状态字段 | `Status` 枚举 + `Problem` 为 `CM_PROB_*` 固定枚举串（本机实测） |
| 硬件 ID | `PCI\VEN_&DEV_` / `USB\VID_&PID_` / `ACPI\` 格式固定（本机实测） |

写死的两张表：

1. **CM_PROB 中文解读表**——不用 `ProblemDescription` 属性：
   它有官方 bug（PowerShell #12510，依赖当前目录才填充，
   基本恒为空）；自维护中文表同时解决英文本地化问题
2. **错误码建议动作表**——有官方出处（MS Support 错误码页
   逐条给出解决步骤），非自造逻辑

确定性风险与对策：

- 本地化：设备名随驱动 INF 任意语言，只作展示透传；
  全部过滤基于数值 / 枚举 / 固定前缀 / class GUID，
  不匹配任何本地化字符串（同 overview 只用 WMI 类名的经验）
- 运行时确定：pwsh 7 随包分发，与目标机 PowerShell 版本无关
- 环境全集（Win10/Win11 × 各版本 × OEM）：WMI schema
  受微软向后兼容纪律保护，版本差异均显式标注（如 `Present`
  Vista–8 不支持、`PNPClass` MOF 与实现不一致，均可在
  设计期排除）；CM_PROB 只增不改义；
  `_t9` 附 schema 探针，现场首次跑老系统即可暴露形态偏离
- 版本兼容：主路径用 `Win32_PnPEntity` 原生数值字段
  （官方 Requirements：Vista+，对 Win10/11 余量 8 年；
  `HardwareID` 是 MOF 正式字段，非后加），
  `Get-PnpDevice` 枚举仅作展示补充
- 防御性解析：字段缺失→null + problem 设备逐设备
  `Get-PnpDeviceProperty` 兜底；未知问题码→原始码透传
  + fallback 文案，信息降级而非功能失败
- 无蓝牙硬件等「无设备」是合法数据，不报错
- WMI 冷启动 ≈ 10s：同 overview，接受首查慢、后续热

## 延迟目标

单次调用秒级（沿用全工具族约束），实测参考：

- problem ≈ 0.5s（Win32_PnPEntity 全枚举后过滤）
- core ≈ 2-3s（四类分别查询 + 服务状态）
- usb ≈ 1-2s（PnP 过滤 + 磁盘接口判断）

## 边界

- 只读盘点：不装驱动、不启用/禁用设备、不改服务
  ——安装动作由模型给出指引（下载 + `pnputil /add-driver`），
  用户确认执行；写系统的动作不进 tool
- `sys` 管设备"负载"（温度/占用），`driver` 管设备"健康"（在不在/驱动对不对）
- 驱动版本是否"过旧"不判断——没有版本基线，硬编码黑/白名单
  会误判（与 startup 不过滤服务厂商同一理由）
- `pnputil /enum-drivers`（驱动仓库全量清单）暂不做：
  信息量大但排查价值低，需要时后补 scope=store

## 里程碑

- [ ] problem（默认 + 无 scope 兜底）—— `tests/_t9.mjs`
- [ ] core（Net / Bluetooth / Audio / 显示）
- [ ] usb（USB 设备 + 可移动存储）
- [ ] `doc\tool\driver.md` + PRD / tool README 同步

## 待拍板

- [ ] usb scope 是否需要「手机 MTP 专项标注」（计维队高频：
      手机连电脑传照片认不出——倾向是，成本一行）
- [ ] problem 输出是否附「该错误码的建议动作」提示语
      （倾向是：28→找驱动，22→被禁用→设备管理器启用，
      属于人话解读而非写操作；MS Support 官方页逐条给出解决步骤，
      有现成出处可翻译写死）
