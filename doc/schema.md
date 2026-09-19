# 数据 schema

状态：讨论稿，字段与口径未拍板。更新：2026-09-19。

采集数据的契约。消费方不限于日志系统，还包括前端仪表盘。两种记录共存，按 `type` 区分：

| `type` | 粒度 | 产生时机 | 主要用途 |
|---|---|---|---|
| `request` | 主 Agent 每次模型调用一条 | 该次调用结束后 | 模型请求日志、逐次成本、仪表盘 |
| `session` | 一场会话一条 | `session_shutdown` | 工具使用、降级、活跃时长、上下文规模 |

请求记录不带 `cwdHash` 与环境字段，靠 `sessionId` 关联会话记录取得。

「值示例」里的 `uuid`、`sha256(...)`、`ISO 8601` 等是格式记号，不是字面值。具体取值见下方示例。

## 共用字段

两种记录都携带。

### 身份

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `v` | `1` | 常量 | 协议版本，接收端据此选择解析规则 |
| `type` | `request｜session` | 常量 | 记录类型，接收端据此选择解析规则 |
| `recordId` | `uuid` | 发送端生成 | 记录唯一标识，接收端去重主键 |
| `installId` | `uuid` | 首次运行生成，存 `telemetry-id` | 区分同一队员的多个工具包拷贝；限流与删除的单位。整目录复制会共用同一 id，属已知行为 |
| `keyFp` | `sha256(apiKey) 前 16 位` | `auth.json` 的 API KEY 哈希 | 识别队员；接收端据此关联指纹到队员的映射表 |
| `kitVersion` | `0.3.1` | 发行版 `VERSION` | 版本分布，决定旧版兼容与问题定位 |

### 服务端补

接收端写入，不由发送端上报。

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `receivedAt` | `ISO 8601，UTC` | 接收端 | 时间基准，客户端时钟不可信 |
| `ip` | `IPv4｜IPv6` | 接收端从连接获取 | 来源统计，处理方式见 [log/receiver/SPEC.md](log/receiver/SPEC.md) 议题 R6 |

## 请求记录字段

### 关联

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `sessionId` | `uuid`，pi 生成 | `ctx.sessionManager` | 关联会话记录与本地会话文件 |
| `seq` | `17` | 发送端累计 | 会话内第几次模型调用，从 1 开始。缺口即丢失率 |

### 时间

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `requestedAt` | `ISO 8601 带本地时区偏移` | 发送端记录 | 调用开始时刻 |
| `durationMs` | `4820` | `turn_end` 时间戳差 | 本次请求的模型调用耗时 |
| `ttftMs` | `640` | 首次 `message_update` 到达耗时 | 首字延迟，近似值：`turn_start` 到首个 assistant `message_update` 的间隔 |

### 模型与用量

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `provider` | `opencode-go` | `turn_end` 的 assistant 消息 | 本次请求的供应商 |
| `model` | `glm-5.3-flash` | 同上 | 本次请求的模型 |
| `thinkingLevel` | `minimal｜low｜medium｜high｜xhigh｜max` | `turn_end` 时的 `ctx.thinkingLevel` | 本次请求的思考档位，取值与 pi 的 `ThinkingLevel` 一致 |
| `input` | `8432` | `message.usage` | 输入 token，含未命中缓存的全部输入 |
| `output` | `1286` | 同上 | 输出 token |
| `cacheRead` | `32768` | 同上 | 命中缓存的输入 token |
| `cacheWrite` | `0` | 同上 | 写入缓存的 token |
| `totalTokens` | `42486` | 同上 | 用量总量 |
| `cost` | `0.2438` | `message.usage.cost.total` | 费用数值，币种见 `currency` |
| `currency` | `CNY｜USD` | provider 的计费币种属性 | 该 provider 的计费币种，与费用计算使用同一价目表的币种。provider URL 为国内则 CNY，否则 USD。属性由插件形式追加到 provider 配置，不改内核；前端自建 provider 时提供币种填写项 |

### 结果

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `status` | `ok｜aborted｜error` | `stopReason`、provider 状态码 | 结束状态，`aborted` 为队员主动取消，`error` 为 provider 非 2xx |
| `errorCode` | `429` | `after_provider_response` | HTTP 状态码，仅 `status = error` 且收到响应时存在。网络层失败（无响应）没有状态码。区分网关限流、故障与模型问题 |
| `stopReason` | `stop｜length｜toolUse｜error｜aborted｜deferred` | `turn_end` | 模型侧结束原因，取值与 pi 的 `StopReason` 一致；`pending` 为中间态不记录。与 `status` 对照解释取消与截断 |

## 会话记录字段

### 会话

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `sessionId` | `uuid`，pi 生成 | `ctx.sessionManager` | 与本地会话文件对应，便于回查 |
| `segmentIndex` | `1` | 发送端累计 | 同一 `sessionId` 的第几次打开，区分恢复与分叉 |
| `reason` | `startup｜new｜resume｜fork` | `session_start` | 区分启动、新建、恢复、分叉 |
| `endReason` | `quit｜reload｜new｜resume｜fork` | `session_shutdown` | 区分正常退出、切换会话、重载 |
| `cwdHash` | `sha256(cwd) 前 8 位` | `ctx.cwd` 哈希 | 区分诊断所在机器，不泄露路径 |

### 时间

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `startedAt` | `ISO 8601 带本地时区偏移` | `session_start` | 会话开始时刻，用于时段分析与跨天归属 |
| `endedAt` | `ISO 8601 带本地时区偏移` | `session_shutdown` | 会话结束时刻 |
| `durationMs` | `2382000` | `endedAt` − `startedAt` | 会话墙钟时长，工时统计 |
| `activeMs` | `1502000` | 发送端累计：各 `turn_start` 到 `turn_end` 的间隔求和 | 实际使用时长，排除等待输入的空档，避免把队员离开的时间算成工时 |

### 用量

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `prompts` | `9` | `agent_start` | 队员提问次数，使用强度 |
| `turns` | `23` | `turn_end` 计数 | 模型往返次数，与请求记录条数对照 |
| `messages` | `47` | `message_start` 计数 | 上下文规模，辅助判断压缩是否必要 |

### 模型

`models` 是**对象数组**：一次会话用到几个「provider + model + thinkingLevel」组合，就有几个元素。请求记录中的标量字段按此键分组聚合即得；发送端仍上报，作请求记录丢失时的兜底，接收端可交叉校验。

元素结构：

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `provider` | `opencode-go` | `turn_end` 的 assistant 消息 | 供应商分布 |
| `model` | `glm-5.3-flash` | 同上 | 模型使用分布 |
| `thinkingLevel` | `minimal｜low｜medium｜high｜xhigh｜max` | `turn_end` 时的 `ctx.thinkingLevel` | 思考档位对成本的影响 |
| `turns` | `23` | `turn_end` 按分组键计数 | 该组合的往返次数，占比最大者即主用模型 |
| `input` | `182000` | `message.usage` 分组累计 | 输入 token，含未命中缓存的全部输入 |
| `output` | `9400` | 同上 | 输出 token，主要计费项之一 |
| `cacheRead` | `61000` | 同上 | 命中缓存的输入 token，单价低于 `input` |
| `cacheWrite` | `0` | 同上 | 写入缓存的 token，部分 provider 计费 |
| `totalTokens` | `252400` | 同上 | 用量总量，与 `turns` 对照看单次往返规模 |
| `cost` | `2.92` | `message.usage.cost.total` 分组累计 | 费用数值，币种见 `currency` |
| `currency` | `CNY｜USD` | provider 的计费币种属性 | 取值规则同请求记录的 `currency` |

元素示例：

```json
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
  "cost": 2.92,
  "currency": "CNY"
}
```

多模型会话示例（同一会话先粗排后精排）：

```json
"models": [
  { "provider": "CST", "model": "glm-5.3-flash",       "thinkingLevel": "low",  "turns": 18, "input": 140000, "output": 7200, "cacheRead": 52000, "cacheWrite": 0, "totalTokens": 199200, "cost": 2.00, "currency": "CNY" },
  { "provider": "CST", "model": "deepseek-v4.1-flash", "thinkingLevel": "high", "turns": 5,  "input": 42000,  "output": 2200, "cacheRead": 9000,  "cacheWrite": 0, "totalTokens": 53200,  "cost": 0.92, "currency": "CNY" }
]
```

两个元素均为国内 provider，币种 CNY；国外 provider 的币种为 USD。同一元素只出现一次 `currency`。

### 上下文

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `compactions` | `0` | `session_compact` | 压缩次数，反映长会话占比 |
| `compactionTokens` | `0` | `session_compact` 的 `tokensBefore` 累计 | 被压缩的 token 规模，压缩本身也计费 |
| `contextPeak` | `38100` | `ctx.getContextUsage()` | 上下文峰值，判断是否贴近窗口上限 |

### 工具

`tools` 是**对象数组**：会话中用到几个「name + scope」组合，就有几个元素。同一工具的不同 scope 各占一个元素，如 `sys(gpu)` 与 `sys(proc)`。

元素结构：

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `name` | `disk｜sys｜startup｜eventlog｜driver｜ls｜runbook` | `tool_execution_end` 的入参 | 七个诊断工具里哪些真被使用 |
| `scope` | `usage`，随工具不同 | 同上 | 子功能分布 |
| `calls` | `2` | `tool_execution_end` 计数 | 使用强度 |
| `failures` | `0` | `isError` 计数 | 工具质量的直接指标，仅 `isError` 计入；`notice` / `degraded` 记入 `degraded` 字段，不算失败 |
| `degraded` | `1` | 结果里 `notice` / `degraded` 出现次数 | 现场降级率，反映免管理员与缺驱动的影响 |
| `totalMs` | `41200` | `tool_execution_start/end` 配对 | 总耗时，定位卡顿工具 |
| `maxMs` | `38000` | 同上 | 最慢一次，判断是否有偶发长耗时 |
| `resultBytes` | `21000` | 结果文本字节数 | 输出体积是否合理，是否触及 50 KiB 裁剪线 |

元素示例：

```json
{
  "name": "disk",
  "scope": "usage",
  "calls": 2,
  "failures": 0,
  "degraded": 1,
  "totalMs": 41200,
  "maxMs": 38000,
  "resultBytes": 21000
}
```

多元素示例（同一 `sys` 工具按 scope 拆分）：

```json
"tools": [
  { "name": "disk", "scope": "usage", "calls": 2, "failures": 0, "degraded": 1, "totalMs": 41200, "maxMs": 38000, "resultBytes": 21000 },
  { "name": "sys",  "scope": "gpu",   "calls": 1, "failures": 0, "degraded": 0, "totalMs": 3100,  "maxMs": 3100,  "resultBytes": 4200 },
  { "name": "sys",  "scope": "proc",  "calls": 3, "failures": 1, "degraded": 0, "totalMs": 9800,  "maxMs": 4100,  "resultBytes": 12600 }
]
```

### 失败

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `providerErrors` | `{ 429: 1 }` | `after_provider_response` 状态码分类计数 | 区分网关限流、故障与模型问题，可由请求记录聚合 |
| `aborted` | `0` | `stopReason = aborted` 计数 | 队员主动取消次数，模型跑偏的信号，可由请求记录聚合 |
| `toolFailures` | `0` | `tool_execution_end` 的 `isError` 合计 | 工具失败总数，与 `tools[].failures` 对照 |

### 环境

| 键 | 值示例 | 来源 | 用途描述 |
|---|---|---|---|
| `os.version` | `10.0.26100` | 运行时 | 兼容性决策 |
| `os.arch` | `x64｜arm64` | 运行时 | 同上 |
| `admin` | `true｜false` | 运行时 | 是否管理员运行，与 `degraded` 对照解释降级原因 |

## 示例

请求记录：

```json
{
  "v": 1,
  "type": "request",
  "recordId": "9e2b71c4d8f34a65",
  "installId": "8c21f0d4-3a7b-4e02-9f18-2b6c5d7e9a10",
  "keyFp": "b7d1c94a2f0e5a33",
  "kitVersion": "0.3.1",
  "sessionId": "1f2e8a3b-5c4d-4e6f-8a90-1b2c3d4e5f60",
  "seq": 17,
  "requestedAt": "2026-09-19T14:32:08+08:00",
  "provider": "opencode-go",
  "model": "glm-5.3-flash",
  "thinkingLevel": "medium",
  "input": 8432,
  "output": 1286,
  "cacheRead": 32768,
  "cacheWrite": 0,
  "totalTokens": 42486,
  "cost": 0.2438,
  "currency": "CNY",
  "durationMs": 4820,
  "ttftMs": 640,
  "status": "ok",
  "stopReason": "stop",
  "receivedAt": "2026-09-19T06:32:11Z",
  "ip": "203.0.113.7"
}
```

会话记录：

```json
{
  "v": 1,
  "type": "session",
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
      "cost": 2.92,
      "currency": "CNY"
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

请求记录约 300–500 字节，会话记录约 1–3 KB。`tools` 元素数上限 512：元素按 name + scope 组合分组而非按调用次数，正常会话几十个即封顶，上限仅防 scope 取值失控撑爆记录。`models` 通常 1–3 项。

## 身份指纹

```
keyFp = sha256("cst-pilot-telemetry:v1:" + apiKey) 前 16 位十六进制
```

服务端用同一算法从自己掌握的 KEY 算出指纹，因此只需维护一张「指纹 → 队员」映射表，不存 KEY 原文。OAuth 与 API KEY 共存时的归属方案见议题 S1。

## 不采集

对话正文、系统提示词、模型输出、工具参数值与输出正文、文件路径原文、会话名、计算机名与用户名、API KEY 原文、硬件序列号。IP 由接收端从连接获取，客户端不参与。

请求记录的「所属会话」只给 `sessionId` 前 8 位，不携带会话名。

只采集本工具自身的运行信息，不做审计、监控与远程控制，也不替代网关账单。

## 能回答的问题

| 问题 | 数据 |
|---|---|
| 谁在用，用多久 | 身份指纹、会话起止与时长 |
| 用了哪些模型，花多少 | 请求记录的 model、token、费用；会话记录 `models` 聚合 |
| 用了哪些工具，失败几次 | 会话记录 `tools` 的调用数、失败数、耗时 |
| 单次调用卡不卡 | 请求记录的 `durationMs`、`ttftMs`、`status` |
| 从哪里接入 | 接收端记录的来源 IP |
| 什么环境，哪个版本 | 工具包版本、`os`、`admin` |

## 议题

数据定义相关的未决项，合并为一张表。传输与机制议题归 [log/sender/SPEC.md](log/sender/SPEC.md) 与 [log/receiver/SPEC.md](log/receiver/SPEC.md)。

| 组 | 编号 | 议题 | 状态与候选 |
|---|---|---|---|
| 身份 | S1 | OAuth 与 API KEY 共存时的归属方案 | 未来引入 OAuth 登录与 API KEY 共存后，`keyFp` 指纹方案需要重新设计。当前按 API KEY 指纹归属 |
| 覆盖盲区 | S2 | 效果指标 | 会话内重复提问次数、队员取消次数、界面等待时长。MVP 不考虑，后续持续跟进 |
| 费用口径 | S3 | 费用计算位置 | 货币字段已定，见 `currency`。A 客户端按价目表算。B 接收端算。C 只存 token，报表时对网关账单 |
