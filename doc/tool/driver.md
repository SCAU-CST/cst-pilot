# driver — 设备驱动排查工具

实现：`agent\home\extensions\driver.ts`（注册薄壳）+ `driver-core.ts`（全部逻辑，零 npm 依赖）。
设计见 `doc\design\driver_design.md`，需求见 `doc\PRD.md`（R7）。

## 背景

排查蓝牙、网卡、声卡的驱动有没有出问题、出在哪个设备上，以及外接设备
（U盘、打印机、无线键鼠）认没认出来。数据全部来自系统自带 WMI/CIM，
Win10 / Win11 通用，免管理员、免安装。

与 sys 的边界：sys 管负载（设备活着但忙），driver 管健康（设备活着吗、
驱动对不对）。与 disk 的边界：盘上容量归 disk，设备和驱动归 driver。

## 调用方式

| 参数 | 适用 scope | 说明 |
|---|---|---|
| `scope` | 全部 | `problem`（默认）/ `core` / `external` / `find` |
| `name` | find | 设备名称子串 |
| `class` | find | 设备类精确名（固定英文类名，如 `Net`、`MEDIA`、`Bluetooth`） |
| `id` | find | 硬件 ID / DeviceID 子串（如 `VID_045E`） |

find 三条件至少传一个，AND 组合；不传 scope 默认 `problem`。

## 返回结构

约定同全部自定义工具：`result[scope]` 为 payload，正常返回数据字段 +
`notice`，失败收敛 `{ error }`。

### problem / find：devices

```jsonc
{
  "devices": [
    {
      "name": "设备名（随驱动可能是任意语言，只透传）",
      "class": "PNPClass（固定英文类名，个别设备为 null）",
      "status": "Error / Unknown / OK",
      "errorCode": 28,                      // ConfigManagerErrorCode 原始值，不翻译
      "deviceId": "USB\\VID_1234&PID_5678\\...",
      "hardwareIds": ["USB\\VID_1234&PID_5678&REV_0100", "..."]
    }
  ],
  "count": 1,
  "notice": "errorCode 为 ConfigManagerErrorCode 原始值（0 = 正常）...盲区..."
}
```

- problem 只取 `Status="Error" OR Status="Unknown"`——不用
  `ConfigManagerErrorCode != 0` 过滤，后者会漏 errorCode=0 的幽灵异常设备
  （指纹识别器有先例）
- find 条件 AND 组合；`id` 对 deviceId 与 hardwareIds 双通道匹配
  （忽略大小写）——HardwareID 是字符串数组，WQL LIKE 不支持，无法下推
- 错误码不做翻译，人话解读与处置建议由模型联网查官方文档

### core：四类硬件现状

| 字段 | 内容 |
|---|---|
| `net[]` | `name` / `connId`（网络连接面板名）/ `physical`（布尔标志，可能误报）/ `connStatus`（NetConnectionStatus 原始值） |
| `bluetooth[]` / `audio[]` | `name` / `status` / `errorCode`（PnP 设备级） |
| `display[]` | `name` / `vendor`（AdapterCompatibility）/ `driver` / `status` / `bus`（PNPDeviceID 首段，PCI / ROOT） |
| `services[]` | `bthserv` / `Audiosrv` 的 `state`（缺失 = 无该服务，合法数据） |
| `drivers[]` | `class`（NET/MEDIA/BLUETOOTH/DISPLAY）/ `device` / `version` / `date`（yyyy-MM-dd）/ `provider` |

- Net 只取 `NetConnectionID IS NOT NULL`（网络连接面板真实条目，结构性
  过滤；不加过滤带出几十条 legacy 伪适配器）。虚拟网卡不剔除——
  「虚拟网卡干扰」的判断前提是模型能看到虚拟网卡
- drivers 表按 DeviceClass 四类过滤，非全量；驱动是否过旧由模型联网
  比对最新版，工具不判断

### external：外置设备 + 可移动存储

- `devices[]`：同 problem 的设备行，来源为 DeviceID 前缀白名单
  `USB\` / `BTHENUM\`（蓝牙外设）/ `DISPLAY\`（显示器；`USB%` LIKE
  天然连带 `USBSTOR\`，U 盘存储节点，属预期覆盖）
- `removable[]`：`model` / `interface` / `mediaType` / `sizeGB`，
  来自 `Win32_DiskDrive`（`InterfaceType='USB' OR MediaType LIKE 'Removable%'`），
  SD 卡在其中
- 内置 USB 设备（自带摄像头）与内置屏同前缀，一并如实返回，由模型区分

## 已知盲区（notice 如实告知）

飞行模式 / 射频开关状态 WMI 读不到；网络打印机不走 PnP 枚举。
设备全正常但功能异常时，先排查这两处。

## 实测（2026-09-03，pwsh 7.6.5，i5-12600KF / Win11 / RTX 5070 Ti）

- 耗时：problem 0.9s / core 4.9s / external 1.0s / find 约 1s；
  WMI 冷启动约 10s（同 sys overview），首查慢后续热
- 本机量：problem 0（健康机空数组合法）/ net 10（过滤前 24）/
  bluetooth 17 / audio 8 / display 2 / drivers 49 行 /
  external 48 外设 + 1 可移动存储 / find：class=Net 22、
  name=Realtek 5、id=VID_ 31

## 实测排除的坑

- **find 的引号嵌套**：WQL 字符串字面量必须用双引号（外层 `-Filter '...'`
  单引号包裹）。内层单引号会把外层提前闭合、过滤条件被静默拆散——
  SilentlyContinue 下不报错，只表现为命中量异常（首版 class=Net
  "命中 1" 实为语义已错，全量应为 22）
- `HardwareID` 是字符串数组，WQL LIKE 不支持 → find 的 id 不下推，
  Node 侧后置双通道匹配
- `USB\` 前缀 LIKE 天然连带 `USBSTOR\`（U 盘存储节点）——外设排查
  正需要它，不视为白名单泄漏
- `PhysicalAdapter` 在部分机器无区分度（本机 VMware / Wintun 虚拟网卡
  也返回 True）——只作展示标志不用于剔除，误标不致命
- `Win32_PnPSignedDriver` 的 `DriverDate` 经 Get-CimInstance 已自动转
  DateTime，`ToString('yyyy-MM-dd')` 直接可用，无需手工解析 DMTF

## 边界

- 只读盘点。不装驱动、不启用禁用设备、不改服务。安装动作由模型给出
  指引（下载 + `pnputil /add-driver`），用户确认后执行，不进 tool
- 驱动版本基线不写死，是否过旧由模型联网比对（硬编码黑白名单会误判）
- `pnputil /enum-drivers`（驱动仓库全量清单）暂不做，需要时后补
  scope=store
