# lhm — LibreHardwareMonitorLib 运行时包

`sys` scope=sensor 的数据源 DLL，随仓库分发（零宿主安装约束）。

## 内容

| 文件 | 来源 | 版本 |
|---|---|---|
| LibreHardwareMonitorLib.dll | [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)（MPL-2.0） | 0.9.6 |
| DiskInfoToolkit.dll / RAMSPDToolkit-NDD.dll / HidSharp.dll / System.IO.Ports.dll / System.Management.dll / System.Threading.AccessControl.dll | 上述 NuGet 包的依赖 | 与 LHM 0.9.6 声明的版本一致 |

TFM 选型：pwsh 7.6 运行于 .NET 10，故取 net10.0（HidSharp 取 netstandard2.0）；架构 win-x64。

## 更新方法

1. `https://www.nuget.org/api/v2/package/LibreHardwareMonitorLib/` 下载最新 nupkg（zip）
2. 解出 `runtimes/win-x64/lib/net10.0/LibreHardwareMonitorLib.dll`
3. 按 nuspec 依赖清单更新各依赖 DLL
4. 跑 `agent\_t6.mjs` 直连验证；注意 0.9.x 已移除 `GetHardware()`，
   若 API 再变需同步 `sys.ts` 的 SENSOR_CMD

## PawnIO 不附带（零安装约束）

LHM 0.9.5 起内核级访问（CPU 温度、主板芯片）不再用 WinRing0
（漏洞驱动，被微软拦），改用需在目标机安装的 PawnIO 驱动。
本项目零宿主安装约束下**不附带也不安装 PawnIO**：

- sensor scope 的 LHM 部分只用用户态可读的传感器（GPU 等）
- CPU 核心温度不可得，以降频信号替代（sys scope=sensor 的 frequency 字段）
- `sys.ts` 会探测 PawnIO：若目标机已装且管理员运行，LHM 自动给出完整传感器

PawnIO：https://pawnio.cc

## 用不到的依赖为什么也打包

`sys.ts` 的 SENSOR_CMD 只开 Cpu/Gpu/Motherboard，存储/内存/控制器关闭时
DiskInfoToolkit、RAMSPDToolkit 等不会被加载。保留它们是防御性的：
一旦未来开启更多硬件类型，不必重新组包。
