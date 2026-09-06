# 第三方组件声明（Third-Party Notices）

CST Pilot 发行版包含以下第三方组件。各组件以其原有许可证分发；本文件仅为汇总说明，许可证原文以各组件随包文件或上游仓库为准。

## 运行时与核心

| 组件 | 版本 | 许可证 | 来源 | 用途 |
|---|---|---|---|---|
| pi (pi.exe) | 0.85.1 | MIT | https://github.com/earendil-works/pi | Agent 运行时（官方 SEA 单文件发行） |
| PowerShell | 7.6.5 | MIT | https://github.com/PowerShell/PowerShell | 诊断工具执行环境（随包 `pwsh/LICENSE.txt`） |
| fd | 10.5.0 | MIT / Apache-2.0（双许可） | https://github.com/sharkdp/fd | 文件查找（bin\fd.exe） |
| ripgrep | 15.2.0 | MIT / Unlicense（双许可） | https://github.com/BurntSushi/ripgrep | 内容搜索（bin\rg.exe） |

## pi 扩展（预打包或随包分发）

| 组件 | 版本 | 许可证 | 来源 | 用途 |
|---|---|---|---|---|
| pi-web-access | 0.18.0 | MIT (c) 2025 Nico Bailon | npm `pi-web-access` | 网页检索/抓取扩展（预打包） |
| pi-open-tui | 0.2.10 | MIT | npm `pi-open-tui` | TUI 文件选择器扩展（随包分发，含其 LICENSE） |
| @ff-labs/pi-fff | 0.10.6 | MIT | npm `@ff-labs/pi-fff` | 文件快速检索扩展（预打包） |
| @ff-labs/fff-bin-win32-x64 | 同 fff | MIT | npm | fff 检索引擎二进制 |
| @ff-labs/fff-node / fff-bun | 同 fff | MIT | npm | fff 运行时适配 |
| ffi-rs | 1.3.7 | MIT | npm `ffi-rs` | FFI 绑定（fff 原生调用） |
| @yuuang/ffi-rs-win32-x64-msvc | — | MIT | npm | ffi-rs 的 Windows 原生库 |
| @mariozechner/clipboard | 0.3.9 | MIT | npm | 剪贴板访问（pi 随带运行资源） |
| photon_rs_bg.wasm (@silvia-odwyer/photon) | — | MIT | https://github.com/silvia-odwyer/photon | 图像缩放/EXIF 处理（向模型发送图片前） |
| @sinclair/typebox | — | MIT | https://github.com/sinclairzx81/typebox | 校验 schema（由 pi 内置别名提供，不随包分发） |
| esbuild | 0.25.10 | MIT | https://github.com/evanw/esbuild | 仅构建时使用（扩展预打包），不出现在发行包 |

## 专用工具

| 组件 | 版本 | 许可证 | 来源 | 用途与条款 |
|---|---|---|---|---|
| WizTree | 4.x（见随包 license.txt） | 专有软件；**仅个人使用免费，商业使用需购买授权** | https://diskanalyzer.com | 磁盘占用快速分析（usage 工具）。随包保留 `wiztree/license.txt`；使用者须自行确认使用场景符合其许可条款 |
| LibreHardwareMonitorLib | — | MPL-2.0 | https://github.com/LibreHardwareMonitor/LibreHardwareMonitor | 硬件传感器读取（sensor/gpu 工具） |

## 说明

1. 本项目自身代码（diagnostics 工具、启动器、打包脚本、文档）随 CST Pilot 以内部项目形式分发。
2. 发行包内 `VERSION` 与 `SHA256SUMS` 用于完整性校验；`SHA256SUMS` 覆盖装配完成时的发行树。
3. WizTree 的商用授权条款请阅读随包 `wiztree/license.txt`；如 CST 的使用构成商业场景，请按其要求购买 supporter code，或将 usage 工具的降级路径（Node 扫描）作为替代。
