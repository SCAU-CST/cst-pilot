# CST Pilot

> Computer Service Team · Portable Diagnostics Kit

**CST Pilot** 是计算机维护队（Computer Service Team, **CST**）的便携式电脑诊断工具包。
成员带着它上门为机主提供服务：扫描内存占用、识别进程、报告磁盘与硬件健康状态。
名称中的 **pi** 致敬本项目所基于的 [pi coding agent](https://github.com/earendil-works/pi)。

## 目录结构

> 目录名统一纯小写。

| 目录 | 是否入库 | 内容 |
|---|---|---|
| `agent\home\`（部分） | ✅ | 隔离的 pi 配置：extensions（自定义工具）、skills、settings.json |
| `doc\` | ✅ | 项目文档（PRD / 设计 / 工具文档） |
| `lhm\` | ✅ | LibreHardwareMonitorLib DLL 包（约 2.7MB，见 `lhm\README.md`） |
| `pi.cmd` | ✅ | 唯一入口，启动隔离的 pi Agent |
| `agent\node_modules\` | ❌ | pi 及依赖（`npm install` 重建，见下） |
| `node\` | ❌ | Node.js 运行时（便携版，另行分发） |
| `pwsh\` | ❌ | PowerShell 7 运行时（便携版，另行分发） |
| `wiztree\` | ❌ | WizTree 便携版（磁盘占用快速分析，需管理员权限，另行分发） |
| `agent\home\{auth,models,models-store,web-search,open-tui}.json` | ❌ | 密钥与运行时状态，不入库 |
| `agent\home\sessions\`、`agent\home\{bin,npm,fff}\` | ❌ | 会话历史与 fff 扩展运行产物，不入库 |

## 依赖声明与环境重建

本仓库只含源码与文档，完整运行环境（约 500MB）不在 git 里，随 zip 分发。
从零重建：

| 依赖 | 版本要求 | 获取方式 | 用途 |
|---|---|---|---|
| Node.js | v22+（本仓库用 24.x 便携版放 `node\`） | nodejs.org 便携 zip | pi 本体运行时 |
| PowerShell 7.6+ | 便携版放 `pwsh\` | GitHub microsoft/PowerShell releases zip | 全部工具的采集通道 |
| WizTree | 便携版放 `wiztree\`（需管理员） | wiztreefree.com | `disk scope=usage` 的 MFT 全盘秒扫 |
| pi coding agent | `@earendil-works/pi-coding-agent` | 在 `agent\` 下 `npm install`（package-lock 锁定版本） | Agent 本体 |
| nvidia-smi | 无需安装 | NVIDIA 驱动自带（`System32\nvidia-smi.exe`，存在才调用） | `sys scope=gpu` 附带显卡状态 |
| PawnIO | 可选 | pawnio.cc | 可选：装了才能读到 CPU 核心温度（未装则用降频信号替代，见 `doc\tool\sys.md`） |

`lhm\` 内的 DLL 已随仓库分发（NuGet 官方包解出，来源与更新方法见
`lhm\README.md`），无需另行下载。

`agent\home\models.json`（模型网关地址与 API KEY）和
`agent\home\auth.json`（登录凭证）含密钥，**不入库**。
新建时参考 `agent\home\models.example.json` 模板填写自己的网关与 KEY。

## 使用方式

把整个目录拷到 U 盘或机主电脑上，运行：

```
pi.cmd
```

所有运行时均为便携版，不在机主电脑上安装任何东西。

## 隔离设计（v7）

- `PI_CODING_AGENT_DIR` 强制指向 `agent\home`，与宿主机的 pi 配置完全隔离
- PATH 白名单：默认只注入 `pwsh`、`node` 和系统目录（设 `PI_INHERIT_HOST_PATH=1` 可追加宿主 PATH）
- `--no-skills --skill agent\home\skills`：只加载自带技能
- `--no-context-files` + `defaultProjectTrust=never`：不读宿主机上的项目级配置
- 控制台 UTF-8（`chcp 65001`）+ `PYTHONUTF8` 注入
- 只读工具集：默认不注册 edit / write / powershell / bash

## 配置要点

- 模型网关与 KEY：`agent\home\models.json`（第三方 LLM 网关，密钥文件不入库，
  模板见 `models.example.json`）
- 自定义工具：`agent\home\extensions\`（`ls` / `disk` / `sys` / `wz-index`，
  文档见 `doc\tool\`）
- 自带技能：`agent\home\skills\`
