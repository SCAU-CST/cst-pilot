# startup — 开机自启盘点工具（R5）

实现：`agent\home\extensions\startup.ts`。需求见 `doc\PRD.md`，
决策记录见 `doc\design\sys_design.md`（待拍板）。

## 背景：为什么从 sys 剥离

R5 原规划为 sys 的 `startup` scope。落地前重新审视后决定剥离为独立工具：

| 维度 | sys（实时负载） | startup（配置盘点） |
|---|---|---|
| 回答的问题 | 此刻发生了什么 | 开机时会拉起什么 |
| 数据性质 | 瞬时 / 采样差分，两次调用结果不同 | 静态配置，两次调用结果相同 |
| 与 sys 的耦合 | proc/gpu/sensor 共享采样、计数器等采集逻辑 | 无共享逻辑，一条静态枚举命令 |

塞进 scope 体系只会让 sys 的描述变长、边界变模糊，而没有换来任何
共享设施收益。独立注册后模型按问题类型选工具更直接。

## 调用方式

无参数，一次调用取全：

```
startup({})
```

返回结构与 sys 一致：`{ startup: { regItems, startupFolders, services, notice } }`。

## 实测输出

```jsonc
{
  "startup": {
    "regItems": [                         // 注册表自启项
      {
        "source": "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
        "name": "Everything",
        "command": "\"D:\\Everything\\Everything.exe\" -startup",
        "disabled": false                 // true = 任务管理器已禁用，不会开机拉起
      }
      // source 含 HKLM\...\Wow6432Node\Run（32 位程序落点）与 RunOnce
    ],
    "startupFolders": [
      {
        "scope": "user",                  // user=当前用户 / allUsers=所有用户
        "path": "C:\\Users\\...\\Start Menu\\Programs\\Startup",
        "items": [ { "name": "Snipaste.lnk", "disabled": null } ]
      }
    ],
    "services": [                         // StartMode='Auto'（含延迟自启），Running 排前
      { "name": "Audiosrv", "display": "Windows Audio", "state": "Running",
        "path": "C:\\WINDOWS\\System32\\svchost.exe -k LocalServiceNetworkRestricted" }
    ],
    "notice": "开机自启盘点（只读）。regItems=注册表 Run/RunOnce 自启项（…）…"
  }
}
```

## 实现要点

一条 pwsh 命令内取四路，全部只读：

| 路 | 来源 | 内容 |
|---|---|---|
| 1 | `Get-Item` 枚举 Run/RunOnce 键值 | 注册表自启项（HKLM / HKCU / Wow6432Node / RunOnce） |
| 2 | `StartupApproved\{Run,Run32,StartupFolder}` 键 | 禁用状态：首字节奇数 = 已禁用 |
| 3 | 启动文件夹（`GetFolderPath('Startup'/'CommonStartup')`） | `.lnk` 等文件列表 |
| 4 | `Win32_Service` StartMode='Auto' | 自启服务，Running 排前，path 超 140 字符截断 |

- **StartupApproved 的意义**：任务管理器"启动应用"的禁用开关不删除
  Run 键，只写 `StartupApproved` 二进制值。只枚举 Run 键会把已被禁用的
  项误报为"会开机拉起"；`disabled=true` 的项如实标注，避免误诊
- **disabled 为 null**：StartupApproved 无对应条目（从未被任务管理器
  碰过）时为 null，等价于启用
- **服务 path 截断**：100+ 个自启服务的完整命令行会撑爆上下文，
  140 字符足够定位到具体程序
- **状态排序**：Running 排前——诊断"开机后什么在跑"时最有价值的在前

## 边界

| 对比 | 切分 |
|---|---|
| vs `sys` | startup 管"开机拉起什么"（静态配置），sys 管"现在什么在吃资源"（实时负载） |
| vs `disk` | 无重叠 |
| 计划任务 | 不在本工具范围（PRD R5 只列注册表/启动文件夹/服务三项；schtasks 枚举噪音大，暂不做） |

## 已知限制

- StartupApproved 按值名匹配注册表项名 / 文件名，HKCU 与 HKLM 同名项
  极少见于同机启用，不做来源级精确匹配
- 服务列表含大量 Windows 系统服务（本机 100 个中约九成是系统路径），
  未按厂商过滤——让模型结合 path 自行区分第三方项，比硬编码过滤规则可靠
- 不含计划任务、WMI 事件订阅等非 Run 键持久化机制（超出 PRD 范围）
