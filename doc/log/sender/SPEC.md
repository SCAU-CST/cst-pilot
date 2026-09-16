# 发送端规格

状态：草案。更新：2026-09-16。数据字段与口径见 [../schema.md](../schema.md)，总体目标见 [../README.md](../README.md)。

## 结论

1. 独立 pi 扩展，目录 `agent/home/extensions/telemetry/`，与 `diagnostics` 平级。只用 Node 内置模块与全局 `fetch`，不引入依赖。
2. 采集靠 `pi.on(...)` 订阅事件，在会话中累计，会话结束发一条记录。不改现有工具代码。
3. 上报异步、有超时、失败落盘重试。全程不阻塞、不抛错、不向会话输出。

## 联网前提

`pi.cmd` 的 `PI_OFFLINE=1` 只关 pi 自身的启动联网（版本检查、包更新、模型目录、pi 自带遥测），不拦扩展请求。已在本地 0.85.1 的 `dist/bundle/chunks/chunk-JVUZSMYM.js` 与 `dist/core/package-manager.js` 核对。

因此 `pi.cmd` 中「Telemetry / update checks disabled」的注释需改写为「pi 自带遥测关闭，本项目遥测单独控制」，并在 [Notice.md](../../Notice.md) 记一条。

## 采集与累计

会话中写内存累计器，`session_shutdown` 时序列化成一条记录。

| pi 事件 | 累计内容 |
|---|---|
| `session_start` | 会话标识、`reason`、起始时间 |
| `agent_start` / `agent_settled` | 提问次数、单次响应时长 |
| `turn_end` | `turns`；`message.usage` 按 provider + model 分组累加；`stopReason` 分类计数 |
| `tool_execution_start` / `_end` | 按工具名与 scope 的调用数、失败数、耗时、结果字节数 |
| `tool_call` | 参数键名，用于提取 scope |
| `model_select` | 模型切换次数 |
| `session_compact` / `_failed` | 压缩次数与 `tokensBefore` 累计 |
| `after_provider_response` | 非 2xx 状态码分类计数 |
| `session_shutdown` | 结束时间、`endReason` |

并行工具调用会让 start / end 交错，耗时靠 `toolCallId` 配对。

会话切换会销毁并重建扩展实例，累计器必须放模块级或磁盘，不能只挂在会话闭包状态里。

## 上报

1. 会话结束序列化出记录，写入内存队列，立即返回。
2. 队列非空即触发发送，不并发。
3. POST，超时 5 秒。
4. 2xx 清空；4xx 丢弃并计数；网络错误或 5xx 追加写本地 JSONL。
5. 下次触发先重发 JSONL，成功按行删除。失败超上限或文件超上限，丢最旧记录。
6. `session_shutdown` 的最后一次发送不等待完成。

一条记录失败就是整场会话丢失，因此重试价值高于事件级方案。落盘时机与上限见 [../schema.md](../schema.md) 议题 S14。

| 文件 | 位置 |
|---|---|
| 安装标识 | `agent/home/telemetry-id` |
| 待发缓存 | `agent/home/telemetry/pending.jsonl`，仅发送失败后写入 |

放在 `agent/home/` 而非易失的 `.state/`，理由：后者被清理会丢数据。

## 降级

| 情况 | 处理 |
|---|---|
| 无网络、超时、5xx | 入盘重试 |
| 4xx、响应异常 | 丢弃并计数 |
| 磁盘只读或空间不足 | 丢弃，只留内存队列 |
| 功能关闭 | 不采集、不落盘、不联网 |

以上均不提示队员。

## 配置

| 项 | 位置 | 默认 |
|---|---|---|
| 开关与端点 | `agent/home/telemetry.json` | 开，端点随发行写入 |
| 触发阈值与超时 | 源码常量 | 5 秒超时 |

用独立文件而非 `settings.json`，因为 pi 未向扩展暴露设置管理器，且自定义字段容易被 pi 的校验或迁移影响。位置本身见 [../schema.md](../schema.md) 议题 S15。

## 工程改动

`pi.cmd` 改遥测注释；`doc/Notice.md` 加一条；`doc/log/README.md` 列表更新。`pack/pack.mjs` 整目录复制 `extensions/`，无需白名单改动。

## 机制待定

| 编号 | 议题 | 候选 |
|---|---|---|
| M1 | 网络路径 | A 直连。B 读 pi 的 `httpProxy` 走代理 |
| M2 | 失败是否可见 | A 完全静默。B 加 `/telemetry:status` 命令 |
| M3 | 缓存超限丢谁 | A 丢最旧。B 停写并告警 |
| M4 | 是否有紧急关闭 | A 改配置才关。B 接收端响应里下发开关 |
| M5 | 扩展形态 | A 独立目录。B 并入 `diagnostics`。C 打成 pi 包 |
