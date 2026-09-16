# 会话记录 schema

状态：讨论稿，字段与口径未拍板。更新：2026-09-16。

发送端与接收端共用的数据契约。粒度已定：一场 pi 会话一条记录，发送端在会话中累计，会话结束上报。

## 记录字段

「值示例」里的 `uuid`、`sha256(...)`、`ISO 8601` 等是格式记号，不是字面值。具体取值见下方示例。

| 组 | 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|---|
| 身份 | `v` | `1` | 常量 | 协议版本，接收端据此选择解析规则 |
| 身份 | `recordId` | `uuid` | 发送端生成 | 记录唯一标识，接收端去重主键 |
| 身份 | `installId` | `uuid` | 首次运行生成，存 `telemetry-id` | 区分同一队员的多个工具包拷贝；限流与删除的单位 |
| 身份 | `keyFp` | `sha256(apiKey) 前 16 位` | `auth.json` 的 API KEY 哈希 | 识别队员；接收端据此关联指纹到队员的映射表 |
| 身份 | `kitVersion` | `0.3.1` | 发行版 `VERSION` | 版本分布，决定旧版兼容与问题定位 |
| 时间 | `startedAt` | `ISO 8601 带本地时区偏移` | `session_start` | 会话开始时刻，用于时段分析与跨天归属 |
| 时间 | `endedAt` | `ISO 8601 带本地时区偏移` | `session_shutdown` | 会话结束时刻 |
| 时间 | `durationMs` | `2382000` | `endedAt` − `startedAt` | 会话墙钟时长，工时统计 |
| 时间 | `activeMs` | `1502000` | 发送端累计，排除等待输入的空档 | 实际使用时长，避免把队员离开的时间算成工时 |
| 会话 | `sessionId` | `uuid`，pi 生成 | `ctx.sessionManager` | 与本地会话文件对应，便于回查 |
| 会话 | `segmentIndex` | `1` | 发送端累计 | 同一 `sessionId` 的第几次打开，区分恢复与分叉 |
| 会话 | `reason` | `startup｜new｜resume｜fork` | `session_start` | 区分启动、新建、恢复、分叉 |
| 会话 | `endReason` | `quit｜reload｜new｜resume｜fork` | `session_shutdown` | 区分正常退出、切换会话、重载 |
| 会话 | `cwdHash` | `sha256(cwd) 前 8 位` | `ctx.cwd` 哈希 | 区分诊断所在机器，不泄露路径 |
| 用量 | `prompts` | `9` | `agent_start` | 队员提问次数，使用强度 |
| 用量 | `turns` | `23` | `turn_end` | 模型往返次数，与 token 量对照看单次成本 |
| 用量 | `messages` | `47` | `message_start` 计数 | 上下文规模，辅助判断压缩是否必要 |
| 模型 | `models[].provider` | `opencode-go` | `turn_end` 的 assistant 消息 | 模型使用分布与成本分摊 |
| 模型 | `models[].model` | `glm-5.3-flash` | 同上 | 同上 |
| 模型 | `models[].thinkingLevel` | `minimal｜low｜medium｜high｜max` | `turn_end`、`model_select` | 思考档位对成本的影响 |
| 模型 | `models[].turns` | `23` | `turn_end` 按 provider + model 分组计数 | 判断本次会话的主用模型 |
| 模型 | `models[].input` | `182000` | `message.usage` | 输入 token，含未命中缓存的全部输入 |
| 模型 | `models[].output` | `9400` | 同上 | 输出 token，主要计费项之一 |
| 模型 | `models[].cacheRead` | `61000` | 同上 | 命中缓存的输入 token，单价低于 `input` |
| 模型 | `models[].cacheWrite` | `0` | 同上 | 写入缓存的 token，部分 provider 计费 |
| 模型 | `models[].totalTokens` | `252400` | 同上 | 用量总量，与 `turns` 对照看单次往返规模 |
| 模型 | `models[].costTotal` | `0.41` | `message.usage.cost.total` | 费用，美元，按模型价目表计算 |
| 上下文 | `compactions` | `0` | `session_compact` | 压缩次数，反映长会话占比 |
| 上下文 | `compactionTokens` | `0` | `session_compact` 的 `tokensBefore` 累计 | 被压缩的 token 规模，压缩本身也计费 |
| 上下文 | `contextPeak` | `38100` | `ctx.getContextUsage()` | 上下文峰值，判断是否贴近窗口上限 |
| 工具 | `tools[].name` | `disk｜sys｜startup｜eventlog｜driver｜ls｜runbook` | `tool_execution_end` 的入参 | 七个诊断工具里哪些真被使用 |
| 工具 | `tools[].scope` | `usage`，随工具不同 | 同上 | 子功能分布，如 `sys(gpu)` 与 `sys(proc)` |
| 工具 | `tools[].calls` | `2` | `tool_execution_end` 计数 | 使用强度 |
| 工具 | `tools[].failures` | `0` | `isError` 计数 | 工具质量的直接指标 |
| 工具 | `tools[].degraded` | `1` | 结果里 `notice` / `degraded` 出现次数 | 现场降级率，反映免管理员与缺驱动的影响 |
| 工具 | `tools[].totalMs` | `41200` | `tool_execution_start/end` 配对 | 总耗时，定位卡顿工具 |
| 工具 | `tools[].maxMs` | `38000` | 同上 | 最慢一次，判断是否有偶发长耗时 |
| 工具 | `tools[].resultBytes` | `21000` | 结果文本字节数 | 输出体积是否合理，是否触及 50 KiB 裁剪线 |
| 失败 | `providerErrors` | `{ 429: 1 }` | `after_provider_response` 状态码分类计数 | 区分网关限流、故障与模型问题 |
| 失败 | `aborted` | `0` | `stopReason = aborted` 计数 | 队员主动取消次数，模型跑偏的信号 |
| 失败 | `toolFailures` | `0` | `tool_execution_end` 的 `isError` 合计 | 工具失败总数，与 `tools[].failures` 对照 |
| 环境 | `os.version` | `10.0.26100` | 运行时 | 兼容性决策 |
| 环境 | `os.arch` | `x64｜arm64` | 运行时 | 同上 |
| 环境 | `admin` | `true｜false` | 运行时 | 是否管理员运行，与 `degraded` 对照解释降级原因 |
| 服务端补 | `receivedAt` | `ISO 8601，UTC` | 接收端 | 时间基准，客户端时钟不可信 |
| 服务端补 | `ip` | `IPv4｜IPv6` | 接收端从连接获取 | 来源统计，处理方式见 [receiver.md](receiver.md) 议题 R6 |

一条记录约 1–3 KB。`tools[]` 最多 8 项，`models[]` 通常 1–2 项。

## 示例

```json
{
  "v": 1,
  "recordId": "0f3a91c47bd2e5a8",
  "installId": "8c21f0d4-3a7b-4e02-9f18-2b6c5d7e9a10",
  "keyFp": "b7d1c94a2f0e5a33",
  "kitVersion": "0.3.1",
  "sessionId": "1f2e8a3b-5c4d-4e6f-8a90-1b2c3d4e5f60",
  "segmentIndex": 1,
  "reason": "startup",
  "endReason": "quit",
  "startedAt": "2026-09-16T14:02:11+08:00",
  "endedAt": "2026-09-16T14:41:53+08:00",
  "durationMs": 2382000,
  "activeMs": 1502000,
  "cwdHash": "a91c4e77",
  "prompts": 9,
  "turns": 23,
  "messages": 47,
  "models": [
    {
      "provider": "opencode-go",
      "model": "glm-5.3-flash",
      "thinkingLevel": "medium",
      "turns": 23,
      "input": 182000,
      "output": 9400,
      "cacheRead": 61000,
      "cacheWrite": 0,
      "totalTokens": 252400,
      "costTotal": 0.41
    }
  ],
  "compactions": 0,
  "compactionTokens": 0,
  "contextPeak": 38100,
  "tools": [
    { "name": "disk", "scope": "usage", "calls": 2, "failures": 0, "degraded": 1, "totalMs": 41200, "maxMs": 38000, "resultBytes": 21000 },
    { "name": "sys", "scope": "gpu", "calls": 1, "failures": 0, "degraded": 0, "totalMs": 3100, "maxMs": 3100, "resultBytes": 4200 }
  ],
  "providerErrors": { "429": 1 },
  "aborted": 0,
  "toolFailures": 0,
  "os": { "version": "10.0.26100", "arch": "x64" },
  "admin": false,
  "receivedAt": "2026-09-16T06:42:02Z",
  "ip": "203.0.113.7"
}
```

## 身份指纹

```
keyFp = sha256("cst-pilot-telemetry:v1:" + apiKey) 前 16 位十六进制
```

服务端用同一算法从自己掌握的 KEY 算出指纹，因此只需维护一张「指纹 → 队员」映射表，不存 KEY 原文。无凭据与多 KEY 情况见议题 S8、S9。

## 不采集

对话正文、系统提示词、模型输出、工具参数值与输出正文、文件路径原文、会话名、计算机名与用户名、API KEY 原文、硬件序列号。IP 由接收端从连接获取，客户端不参与。

## 议题

### 数据完整性

| 编号 | 议题 | 候选 | 影响 |
|---|---|---|---|
| S1 | 上报时机 | A 仅在 `session_shutdown` 发一条。B 会话中定期把同一条 upsert 到服务端。C 结束发，同时会话中写本地快照，下次启动补发 | 决定强退丢多少数据。B 要求接收端支持 upsert，C 不丢但多一层实现 |
| S2 | 崩溃怎么算 | A 接受丢失。B 靠 S1 的 C 方案补。C 会话开始就发一条空记录，结束时更新 | 只有 B、C 覆盖断电与强杀 |

### 记录口径

| 编号 | 议题 | 候选 |
|---|---|---|
| S3 | 分段还是整场一条 | A 每次打开 pi 记一条，同 `sessionId` 靠 `segmentIndex` 区分。B 按 `sessionId` 合并，接收端累加 |
| S4 | 模型维度 | A 只记最后使用的模型。B 按模型分组小计。C 记主模型加切换次数 |
| S5 | 工具维度 | A 只记总调用数。B 按工具名分组。C 再拆 scope，区分 `sys(gpu)` 与 `sys(proc)` |
| S6 | 失败怎么定义 | 工具返回 `notice` / `degraded` 算不算失败；provider 非 2xx 按状态码分类还是只记总数 |
| S7 | 时间口径 | A 墙钟时长。B 活跃时长，排除等待输入的空档。跨零点归到开始那天还是结束那天 |

### 身份与环境

| 编号 | 议题 | 候选 |
|---|---|---|
| S8 | 无 KEY 的会话怎么算 | OAuth 登录的 provider 没有 KEY。A 不归属到人。B 用 `installId` 兜底归属 |
| S9 | 多 KEY 取哪个 | A 当前生效 provider。B 每个 provider 各一个指纹，按实际使用的 provider 归属 |
| S10 | 是否记 `admin` | 它与工具降级强相关，建议记 |
| S11 | 会话名要不要 | 建议不传原值，`cwd` 只传哈希 |

### 覆盖盲区

| 编号 | 议题 | 候选 |
|---|---|---|
| S12 | 启动期失败 | 扩展加载失败、pi 起不来、凭据没配时没有会话，也就没有数据。A 接受盲区。B 加独立启动探针，会话建立前上报一次 |
| S13 | 效果指标 | 会话内重复提问次数、队员取消次数、界面等待时长都是会话级可统计的计数。要不要收 |

### 传输与口径

| 编号 | 议题 | 候选 |
|---|---|---|
| S14 | 缓存与重试 | 落盘时机（仅失败后写、还是先写再发）与缓存上限 |
| S15 | 配置位置 | A 独立 `telemetry.json`。B `settings.json`。C `pi.cmd` 注入环境变量 |
| S16 | 是否采样 | 会话级数据量已很小，建议删除该议题，直接不采样 |
| S17 | 费用口径 | A 客户端按价目表算。B 接收端算。C 只存 token，报表时对网关账单 |
