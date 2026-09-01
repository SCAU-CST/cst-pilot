---
name: startup
description: startup 工具的返回字段说明。覆盖三块数据的内容、disabled 三态的含义、数据来源与已知边界。
---

# startup 工具说明

盘点开机自启项的只读工具。无参数，一次调用取全，约 1.5 秒返回，不做任何修改。

## 数据来源

1. 注册表自启项：`Get-Item` 枚举 HKLM 与 HKCU 的 Run / RunOnce 键，另含 HKLM Wow6432Node\Run（32 位程序在 64 位系统上的自启落点）
2. 禁用状态：读 `StartupApproved` 键（任务管理器"启动应用"开关的落点，该开关不删除 Run 键，只写此二进制值），首字节奇数表示已禁用
3. 启动文件夹：当前用户与所有用户的 Startup 文件夹内文件列表
4. 自启服务：`Win32_Service` 中 StartMode=Auto 的记录（含延迟自启）

## 返回字段定义

1. `regItems`：注册表自启项。`source` 为所在注册表键；`name` 为项名；`command` 为实际执行的命令行；`disabled` 为禁用状态
2. `startupFolders`：`scope` 为 user（当前用户）或 allUsers（所有用户）；`path` 为文件夹路径；`items` 内每项含 `name` 与 `disabled`
3. `services`：`name` / `display` / `state`（Running 的排在前面）/ `path`（超过 140 字符截断）
4. `disabled` 三态：`true` = 已在任务管理器禁用，不会开机拉起；`false` = 启用中，会开机拉起；`null` = StartupApproved 无对应条目（任务管理器从未操作过），等价于启用

## 已知边界

1. 不含计划任务、WMI 事件订阅等非 Run 键持久化机制
2. StartupApproved 按值名匹配注册表项名 / 文件名，不做来源级精确匹配
3. 服务列表未按厂商过滤，绝大多数为 Windows 系统服务（path 指向 System32），第三方服务 path 通常指向其他安装目录
4. 结果中的 `notice` 字段是附注说明，转达给队员时不能省略
