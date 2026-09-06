# CST Pilot

> Computer Service Team · Portable Diagnostics Kit

**CST Pilot** 是计算机维护队（Computer Service Team, **CST**）的便携式专用Agent。

特点：
1. 基于Pi改的定制Agent，专门用于给计维队员提供便捷的AI技术支持。
2. 定制Agent有专门的提示词和SKILLS。并且有专用的工具获取磁盘状态，进程占用状态等。
3. 安全：在代码层面严格限制了Agent只能只读获取内容，没有任何途径能够修改机主电脑。
4. 高效：定制工具利用了WizTree等社区开源工具，为高效扫描获取数据提供了性能支持。
5. 即插即用。本项目发行版可存放在U盘，内置所有所需的环境。不必在机主电脑上安装任何东西。

## 功能

### 当前已实现

1. 扫描机主的磁盘状态，分析C盘等磁盘的文件占用情况，AI分析后可给出清理建议
2. 分析机主当前进程的运行状态，给出占用CPU，内存，GPU等状态
3. 获取机主硬件参数，以及温度、风扇、电压、降频等
4. 整机负载概况：物理内存、CPU 总占用率、页面文件、开机时长
5. 开机自启盘点：注册表 Run 键（含任务管理器禁用状态）、启动文件夹、自启服务
6. 获取Windows事件日志：最近错误/警告、开关机·蓝屏历史、应用崩溃、服务故障、登录审计，可自定义查询
7. 设备与驱动健康：异常设备定位、网卡/蓝牙/音频/显示现状与驱动版本、外接设备识别

### 未来计划

暂无。

## 目录结构

> ✅ 已入库　❌ 不入库

```
cst-pilot/
├── pi.cmd                          ✅ 唯一入口，启动隔离的 pi Agent（v9，见下）
├── doc/                            ✅ 项目文档（PRD / 设计 / 工具文档）
├── pack/                           ✅ 可复现发行构建脚本（pack.mjs）
├── THIRD-PARTY-NOTICES.md          ✅ 第三方组件声明（随发行包分发）
├── lhm/                            ❌ DLL 不入库（发行版打包时从本地拷入，见 lhm/README.md）
└── agent/
    ├── node_modules/               ❌ pi 及依赖（开发环境；发行版用官方 pi.exe，不带此目录）
    └── home/                       ✅（部分）隔离的 pi 配置：extensions（诊断工具）、skills、settings.json
        ├── {auth,models,models-store,web-search,open-tui}.json   ❌ 密钥与运行时状态
        ├── sessions/               ❌ 会话历史
        └── {bin,npm,fff}/          ❌ fff 扩展运行产物
```

## 启动器（pi.cmd v9）

- **双形态**：发行树存在 `pi.exe`（官方 pi 0.85.1 SEA 单文件）则直接运行；开发环境回退到 `node\ + agent\node_modules` 的 0.2 布局。
- **客户机零写入**：所有易变状态重定向到 U 盘内 `.state\`：`TMP/TEMP → .state\tmp`（jiti 缓存、日志、PDF 临时输出）、`XDG_CACHE_HOME → .state\cache`、`FFF_FRECENCY_DB/HISTORY_DB → .state\data`、`PSModuleAnalysisCachePath → .state\cache`（PowerShell 模块分析缓存，其默认 LOCALAPPDATA 不受 XDG_CACHE_HOME 影响）。目录创建失败（只读介质/写保护/空间不足）时报错退出，不静默泄漏到客户机。已实测审计（2026-09-06）：**全新客户机零写入**；唯一已知限制——若客户机已有 pwsh 的 JIT 启动优化档案（`StartupProfileData-*`），便携 pwsh 会更新它（二进制 JIT 档案，无用户数据；pwsh 硬编码行为，无官方开关，PowerShell issue #26528），无法隔离。
- **遥测与更新检查全关**：`PI_OFFLINE=1`（pi 启动网络操作、安装/更新遥测、版本检查）+ settings `enableInstallTelemetry=false` + `POWERSHELL_TELEMETRY_OPTOUT=1` + `POWERSHELL_UPDATECHECK=Off`。
- **隔离**：`PI_CODING_AGENT_DIR` 强制指向 `agent\home`；严格 PATH 白名单；`--no-skills --no-context-files`；`defaultProjectTrust=never`。

## 注意事项

1. 本仓库只含源码与文档，完整运行环境请用 pack 脚本构建（见下）。
2. 当前实现中，提示词为 `APPEND_SYSTEM.md`而非熟知的`AGENTS.md`，原因见 [doc/Notice.md](doc/Notice.md)
3. 模型URL和API当然是不包括的。如果你是CST的队员且需要相关资源，请联系你们的委员。
4. WizTree 仅个人使用免费、商业使用需授权，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 发行构建（0.3-B）

发行形态：**官方 pi.exe（SEA 单文件）+ 本仓库内容 + 预打包扩展**，白名单装配、零运行态（不含 sessions/fff 数据库/auth 文件/npm 缓存），并生成 `VERSION` 与 `SHA256SUMS`。装机大小约 905 个文件 / 400MB，zip 约 159MB，FAT32 U 盘解压约 1 分钟。

```cmd
node\node.exe pack\pack.mjs --official <官方 pi-windows-x64-0.85.1.zip> --out <新目录> --zip
```

- 扩展预打包：pi-web-access、pi-fff 经 esbuild（首次需联网下载，之后离线可复现）；pi-open-tui 零依赖原样分发；settings.json 的 `packages` 指向本地路径包，离线不安装。
- 打包后自动冒烟（`--print` 走一次完整模型调用）；升级 pi.exe 版本必须先改 pack.mjs 的 `PI_VERSION` 并走全量验收（doc/test/README.md）。
- 运行时会在 U 盘内生成 `.state\`（jiti/PowerShell/fff 缓存）与 `agent\home\sessions/`，属设计内行为，不影响客户机；升级换包时丢弃即可。



## 使用方式

下载最新的发行版。把整个目录拷到电脑/U盘或者任何地方，然后双击运行：

```
pi.cmd
```

**首次运行**需在 pi 内执行 `/login` 选择 provider 并填写 API key（key 不随包分发；凭据写入本机的 `agent\home\auth.json`，属该机的本地状态）。模型目录缓存（models-store.json）随包，无凭据，离线可见模型列表。

# 致谢

名称中的 **pi** 致敬本项目所基于的 [pi coding agent](https://github.com/earendil-works/pi)。感谢这一伟大的开源项目。
