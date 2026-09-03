# Design — driver 设备驱动排查工具

对应 `doc\PRD.md`。定位是全面诊断矩阵的设备驱动维度：

- 排查蓝牙、网卡、声卡的驱动有没有出问题，出在哪个设备上
- 排查外接设备（U盘、打印机、无线键鼠等）认没认出来

## TLDR

`driver` 只做只读的设备与驱动健康盘点。单工具多 scope，
沿用 sys / startup 已验证的模式。调用方是模型，一份描述、
一套返回结构（`data / notice / error`）。

数据全部来自系统自带的 WMI/CIM。Win10 / Win11 通用，
免管理员、免安装。

和 sys 的边界：sys 管负载（设备活着但忙），driver 管健康
（设备活着吗、驱动对不对）。和 disk 的边界：盘上容量归
disk，设备和驱动归 driver。

## 选型

A 单工具多 scope / B 每类设备一工具 / C 全量快照，选 **A**。

- 各 scope 同源同构，都是 PnP 枚举加不同过滤（异常设备 /
  关键硬件 / 外置设备 / 指定查询）。拆开就得多写几份工具描述
- 模型侧没有自由 shell，pwsh 命令都由工具在代码里动态拼接
  生成（模板 + 参数）。三个业务 scope 盖不住的冷门查询没有
  兜底路径，所以必须留一个 find 入口
- C 把最贵路径（全枚举）绑死在每次调用上
- 驱动的更新、卸载、回滚不在定位内，属于安装侧。见「边界」

## 接口

```
driver({ scope? })
│
├─ problem    异常设备排查（默认）。无 scope 时兜底
│             Status=Error/Unknown 的 PnP 设备
│             附硬件 ID（VEN/DEV）和原始错误码
│
├─ core       常见硬件现状快照
│             Net（全部网卡，标注物理 / 虚拟）
│             Bluetooth（设备 + bthserv 服务状态）
│             Audio（设备 + Audiosrv 服务状态）/ 显示
│             四类都附驱动版本和日期，供模型联网比对
│
├─ external   外置设备排查
│             在线外设：名称 / 类 / 驱动状态 / 硬件 ID
│             覆盖 USB、蓝牙外设，附可移动存储
│             （U盘、移动硬盘、SD 卡）
│
└─ find       指定设备查询，补前面三个 scope 的长尾
              至少传一个条件：
              name?   名称子串
              class?  设备类，固定英文类名精确匹配
              id?     硬件 ID / DeviceID 子串
              输出字段同 problem，附 Status 和原始错误码
```

各 scope 对应的典型工单：

- 蓝牙不见了：problem 为空就看 core，多半是服务停了或设备被禁用
- 没声音：和蓝牙同构。core 的 Audio 看设备在不在、
  Audiosrv 服务停没停
- 上不了网：core 的 Net 区分驱动缺失、媒体断开、虚拟网卡干扰
- 外设认不出来：external 看设备在不在枚举里、驱动状态如何
- 问某个具体设备（触控板、指纹、内置摄像头）：find 按名称
  或硬件 ID 直接找

## 架构

外部只暴露一个接口，复杂度都收在实现里：

```
driver({ scope })
│
├─ driver.ts   路由 + 参数校验 + 结果包装
│
├─ collectProblem()   Error/Unknown 合并
├─ collectCore()      按类查询 + 服务状态
├─ collectExternal()  外置总线过滤
├─ collectFind()      条件过滤
└─ runPwsh / 超时 / 解析   ← 共享设施
```
`collectX()` 只给实现和直连 harness（`_t*.mjs`）测试用。

## 采集要点

- 数据一律来自 WMI/CIM 类的原生字段。`ConfigManagerErrorCode`
  和 `HardwareID` 都是 MOF 正式属性，一条查询出齐。
  不做逐设备二次查询。字段缺失就置 null
- problem：`Win32_PnPEntity` 按 Status 过滤。Error 和 Unknown
  合并取。只按 `ConfigManagerErrorCode != 0` 过滤会漏设备，
  指纹识别器有先例（Stack Overflow 有案）
- core 的 Net：用 `Win32_NetworkAdapter`，全部返回并附
  `PhysicalAdapter` 标志。不剔除——「虚拟网卡干扰」的判断
  前提是模型能看到虚拟网卡（Hyper-V、VPN、虚拟显示器）。
  用 `NetConnectionStatus` 区分媒体断开和驱动问题
- core 的 Bluetooth：附 `bthserv` 服务状态。蓝牙消失最常见
  的原因是服务停止或设备被禁用，只查 PnP 会漏诊
- core 的 Audio：附 `Audiosrv` 服务状态。没声音的高频原因
  和蓝牙同构：音频服务停了或设备被禁用
- core 的显示：复用 `Win32_VideoController`，和 sys gpu 同源
- 驱动版本 / 日期：core 四类统一附上。来源是
  `Win32_PnPSignedDriver`，只查 Net / Bluetooth / Audio /
  显示这几类，不做全量枚举。是否过旧由模型联网查最新版比对，
  工具不判断
- external：PnP 设备按 `DeviceID` 前缀白名单过滤，目前收
  `USB\`（U盘、打印机、摄像头、无线接收器）、`BTHENUM\`
  （蓝牙外设：无线鼠标、键盘、耳机）和 `DISPLAY\`
  （显示器，外接 / 扩展坞场景；内置屏同前缀，由模型区分）。
  后续有别的总线再补
- 可移动存储来自 `Win32_DiskDrive`，取 InterfaceType=USB 或
  MediaType 可移动的项，SD 卡也在其中
- 内置 USB 设备（笔记本自带摄像头等）也会出现在列表里，
  一并如实返回，由模型区分
- find：同一条 `Win32_PnPEntity` 枚举，按条件动态拼接 WQL。
  模型输入只进三个结构化参数：name / id 子串转义后拼进
  LIKE，class 精确匹配固定类名。拼接只接受白名单字段，
  不暴露任意 WQL。至少传一个条件，防全量倾倒
- 全部查询免管理员、免安装，纯 WMI/CIM

错误码不做翻译。`ConfigManagerErrorCode` 原样返回，
人话解读和建议动作由模型联网查官方文档自己判断。
工具只负责如实采集，不养对照表

## 确定性

命令由代码动态拼接（约 9 条 WMI/CIM 查询模板，同 sys 的
命令模板模式）。拼接参数只来自白名单字段，输出仍是机器状态
的纯函数，同状态同输出。

- 过滤只用数值、枚举、固定前缀、class GUID，不匹配本地化字符串。
  设备名随驱动可能是任意语言，只作展示透传。overview 已验证
  这条经验
- 错误码原样透传，不解释不翻译。没有蓝牙硬件之类的情况
  是合法数据，不报错
- pwsh 7 随包分发，和目标机 PowerShell 版本无关
- WMI 冷启动约 10s，同 overview。首查慢，后续热

单次调用秒级，沿用全工具族约束。problem 约 0.5s，
core 约 3-4s，external 约 1-2s，find 同 problem 路径。

## 兼容性

目标环境：不同品牌和配置的机器，Win10 / Win11 各版本，
包括 OEM 定制镜像和不同语言的系统。

- 只用系统自带的 WMI/CIM 类。微软对 WMI schema 有向后兼容
  承诺，老字段不删
- 不按系统版本号写分支。一套命令跑所有目标机，版本差异
  全靠字段值本身体现
- 不假设硬件存在。没有蓝牙、没有独显、没插外设，都是合法数据
- 不假设系统语言。见「确定性」
- 32 位系统能不能跑，取决于随包 pwsh 的架构。这属打包层
  约束，不在本设计内

各数据源的版本下限和已知坑：

| 数据源 | 版本下限 | 已知坑与对策 |
|---|---|---|
| Win32_PnPEntity | Vista | PNPClass 个别设备为空，不拿来过滤；HardwareID 个别设备为空，置 null |
| Win32_NetworkAdapter | Vista | PhysicalAdapter 个别虚拟网卡误报。只作展示标志不用于剔除，误标不致命 |
| Win32_PnPSignedDriver | Vista | 全枚举慢，按类过滤；DriverDate 是 DMTF 格式字符串，要转 |
| Win32_VideoController | XP | 无 |
| Win32_Service | XP | bthserv、Audiosrv 各版本同名 |
| Win32_DiskDrive | XP | InterfaceType 取值固定（IDE / USB 等） |

## 边界

- 只读盘点。不装驱动、不启用禁用设备、不改服务。安装动作由
  模型给出指引（下载 + `pnputil /add-driver`），用户确认后执行。
  写系统的动作不进 tool
- sys 管设备负载（温度、占用），driver 管设备健康（在不在、
  驱动对不对）。driver 只到驱动层为止，IP 配置、网络连通性、
  信号强度不在列
- 两个已知盲区，返回的 notice 里如实告知模型：飞行模式 /
  射频开关状态 WMI 读不到；网络打印机不走 PnP 枚举，
  external 看不到。设备全正常但功能异常时，先排查这两处
- 版本基线不写死。工具如实上报驱动版本和日期，是否过旧由模型
  联网比对最新版（本环境允许联网，web-access）。硬编码黑名单
  或白名单会误判，不进代码，理由同 startup 不过滤服务厂商
- `pnputil /enum-drivers`（驱动仓库全量清单）暂不做。信息量大
  但排查价值低，需要时后补 scope=store

## 里程碑

- [ ] problem（默认 + 无 scope 兜底），测试 `tests/_t9.mjs`
- [ ] core（Net / Bluetooth / Audio / 显示）
- [ ] external（外置设备 + 可移动存储）
- [ ] find（name / class / id 过滤）
- [ ] `doc\tool\driver.md`，同步 PRD 和 tool README
