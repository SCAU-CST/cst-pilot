# CST Pilot

> Computer Service Team · Portable Diagnostics Kit

**CST Pilot** 是计算机维护队（Computer Service Team, **CST**）的便携式电脑诊断工具包。
成员带着它上门为机主提供服务：扫描内存占用、识别进程、报告磁盘与硬件健康状态。
名称中的 **pi** 致敬本项目所基于的 [pi coding agent](https://github.com/earendil-works/pi)。

## 目录结构

> 目录名统一纯小写。

| 目录 | 内容 |
|---|---|
| `agent\` | pi 本体（node_modules + 隔离的 home 目录） |
| `node\` | Node.js 运行时（便携版） |
| `pwsh\` | PowerShell 7 运行时（便携版） |
| `wiztree\` | WizTree 便携版（磁盘占用快速分析，需管理员权限） |
| `doc\` | 项目文档 |
| `pi.cmd` | 唯一入口，启动隔离的 pi Agent |

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

- 模型与 API KEY：`agent\home\models.json`（由 axon 统一管理）
- 自定义工具：`agent\home\extensions\`（内置 `disk.ts`、`wz-index.ts`）
- 自带技能：`agent\home\skills\`
