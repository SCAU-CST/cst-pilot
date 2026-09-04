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
├── pi.cmd                          ✅ 唯一入口，启动隔离的 pi Agent
├── doc/                            ✅ 项目文档（PRD / 设计 / 工具文档）
├── lhm/                            ❌ DLL 不入库（发行版打包时从本地拷入，见 lhm/README.md）
└── agent/
    ├── node_modules/               ❌ pi 及依赖（npm install 重建，见下）
    └── home/                       ✅（部分）隔离的 pi 配置：extensions（自定义工具）、skills、settings.json
        ├── {auth,models,models-store,web-search,open-tui}.json   ❌ 密钥与运行时状态
        ├── sessions/               ❌ 会话历史
        └── {bin,npm,fff}/          ❌ fff 扩展运行产物
```

以下目录随发行版分发，不在仓库中：

```
cst-pilot/
├── node/                           ❌ Node.js 运行时（便携版，另行分发）
├── pwsh/                           ❌ PowerShell 7 运行时（便携版，另行分发）
└── wiztree/                        ❌ WizTree 便携版（磁盘占用快速分析，需管理员权限，另行分发）
```

## 注意事项

1. 本仓库只含源码与文档，完整运行环境请看发行部分。
2. 当前实现中，提示词为 `APPEND_SYSTEM.md`而非熟知的`AGENTS.md`，原因见 [doc/Notice.md](doc/Notice.md)
3. 模型URL和API当然是不包括的。如果你是CST的队员且需要相关资源，请联系你们的委员。
4. 发行（拷贝整个目录到 U 盘）前，删除 `wiztree\WizTree3.ini`：它是上一台机器的界面状态（DPI、窗口位置等），跨机携带可能触发 WizTree 启动崩溃；WizTree 首次运行会自动重建默认配置，实测删除无副作用。



## 使用方式

把整个目录拷到 U 盘上，运行：

```
pi.cmd
```

# 致谢

名称中的 **pi** 致敬本项目所基于的 [pi coding agent](https://github.com/earendil-works/pi)。感谢这一伟大的开源项目。
