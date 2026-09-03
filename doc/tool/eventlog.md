# eventlog — 事件日志工具（M1–M8）

实现：`agent\home\extensions\eventlog.ts`（注册薄壳）+ `eventlog-core.ts`（全部逻辑，零 npm 依赖）。
设计见 `doc\design\event_design.md`，需求见 `doc\PRD.md`（R6）。

## 背景

维修场景的故障线索——意外关机、蓝屏、程序崩溃、服务起不来——都沉淀在
Windows 事件日志里，此前只能手动翻事件查看器。eventlog 让 pi 直接读取并汇总。
与 sys 一句话分工：sys 管"现在什么在吃资源"（实时负载），eventlog 管
"过去发生过什么"（历史痕迹）。

单工具多 scope（sys 同构）：只注册一个工具名，调用时用 `scope` 参数选择子功能。
每个分支自含全部参数，`logName` 不是全局覆盖参数（仅 query 可选、detail 必传）。

## 调用方式

| 参数 | 适用 scope | 说明 |
|---|---|---|
| `scope` | 全部 | `recent`（默认）/ `boot` / `crash` / `service` / `disk` / `security` / `query` / `detail` |
| `hours` | 除 detail 外 | 时间窗（小时），默认 24，上限 720 |
| `top` | 除 detail 外 | 事件列表条数上限，默认 100（硬上限 100） |
| `level` | recent / query | 最低级别档 `warn`（Warning 及更严重）/ `error`；recent 默认 warn，query 省略=全级别 |
| `kind` | boot | `all`（默认）/ `unexpected` / `bluescreen` |
| `type` | security | `all`（默认）/ `logonFail` / `lockout` |
| `app` | crash | 程序名/模块名模糊过滤（消息子串，不区分大小写） |
| `name` | service | 服务名模糊过滤（消息子串） |
| `ids` | query | 事件 ID 数组（0–65535 整数，下推过滤） |
| `provider` | query | 提供程序正则（1 秒超时保护，后置过滤） |
| `msg` | query | 消息子串过滤 |
| `logName` | query / detail | query 单通道（默认 System+Application）；detail 必传 |
| `recordId` / `id` | detail | 二选一必传；recordId 直取记录号，id 取该 ID 最近一条 |

## LLM 收到的提示词

`Available tools:` 列表中的行：

```
- eventlog: Read Windows event logs (read-only): recent errors/warnings, boot/unexpected-shutdown/BSOD history, app crashes, service failures, disk/file-system errors, logon audit, custom queries, and single-event full text
```

`Guidelines:` 中的条目：

```
- Use eventlog scope=recent when the user reports odd behavior, crashes, or sluggishness and you need recent error/warning context from the event logs.
- Use scope=boot for 'did it power off / blue screen' questions (unexpected shutdown IDs, BugCheck, WHEA hardware errors); scope=crash for app crashes; scope=service for services failing to start or dying; scope=disk for disk/file-system errors.
- Use scope=query with ids/provider/msg to dig for specific events beyond the built-in whitelists; use scope=detail with a recordId (or id) to read one event's full message.
- scope=security (logon audit) needs administrator; it degrades with an explicit notice when running non-elevated.
```

Function schema（每次请求的 tools 数组中）：

```jsonc
{
  "name": "eventlog",
  "description": "只读事件日志工具，按 scope 选择子功能（不传默认 recent）：recent=近 N 小时错误/警告汇总；boot=开关机/意外关机/蓝屏历史（含 WHEA 硬件错误）；crash=应用崩溃与启动失败（含故障模块，可按程序名过滤）；service=服务启动失败/挂起/崩溃（可按服务名过滤）；disk=磁盘/文件系统报错与掉盘；security=登录审计（需管理员，非管理员自动降级提示）；query=按事件 ID/级别/提供程序/消息子串自定义查询；detail=按 recordId（或 id 取最近一条）读取单条完整原文。",
  "parameters": {
    "type": "object",
    "properties": {
      "scope":    { "type": "string", "enum": ["recent", "boot", "crash", "service", "disk", "security", "query", "detail"] },
      "hours":    { "type": "number", "description": "可选，时间窗（小时），默认 24，上限 720。除 detail 外各 scope 通用。" },
      "top":      { "type": "number", "description": "可选，事件列表条数上限，默认 100（硬上限 100）。除 detail 外各 scope 通用。" },
      "level":    { "type": "string", "enum": ["warn", "error"] },
      "kind":     { "type": "string", "enum": ["all", "unexpected", "bluescreen"] },
      "type":     { "type": "string", "enum": ["all", "logonFail", "lockout"] },
      "app":      { "type": "string", "description": "scope=crash 可选，程序名/模块名模糊过滤…" },
      "name":     { "type": "string", "description": "scope=service 可选，服务名模糊过滤…" },
      "provider": { "type": "string", "description": "scope=query 可选，提供程序正则…" },
      "msg":      { "type": "string", "description": "scope=query 可选，消息子串过滤…" },
      "ids":      { "type": "array",  "description": "scope=query 可选，事件 ID 数组（0-65535 整数，下推过滤）。" },
      "logName":  { "type": "string", "description": "scope=query 可选 / detail 必填…" },
      "recordId": { "type": "number", "description": "scope=detail 与 id 二选一必填…" },
      "id":       { "type": "number", "description": "scope=detail 与 recordId 二选一必填…" }
    }
  }
}
```

## 返回结构

`{ content: [{ type: "text", text: JSON.stringify(result) }], details: result }`，
`result[scope]` 即 payload，约定同全部自定义工具：正常返回数据字段 + `notice`，
失败收敛 `{ error }`（security 降级额外带 `admin` / `degraded`）。

各 scope 查询类 payload 的公共字段：

```jsonc
{
  "logs": ["System", "Application"],   // 实际查询通道（多组取并集）
  "hours": 24, "top": 100,
  "level": "warn",                     // 最低级别档回显（scope 未传时无此字段）
  "total": 121,                        // 时间窗内命中总数（含未显示的更早记录）
  "truncated": false,                  // total > top 时 true，notice 会说明
  "unreadable": 0,                     // 消息资源损坏被跳过的记录数（毒事件）
  "noMatch": [],                       // 条件级零命中提示码（见实现）
  "admin": false,                      // 查询进程是否管理员
  "events": [                          // 最新 top 条，时间倒序
    {
      "logName": "System",
      "time": "2026-09-03 08:10:46",
      "recordId": 154433,              // scope=detail 直取原文用
      "level": 3, "levelName": "Warning",
      "provider": "Microsoft-Windows-Hyper-V-VmSwitch",
      "id": 234,
      "msg": "…"                       // ≤200 字符单行简述；无消息文本为 null
    }
  ],
  "counts": [                          // 来源/ID 折叠计数表，n 降序，最多 100 组
    { "key": "hcmon/0", "provider": "hcmon", "id": 0, "n": 364, "last": "2026-09-03 08:35" }
  ],
  "countsTruncated": false,
  "notice": "近 24 小时 System + Application（level=warn 及更严重）命中 121 条。…"
}
```

`counts` 是设计的体积支柱：警告刷屏的机器上，模型看到的是
"hcmon/0 × 364，最近 08:35" 一行而不是 364 行。`sum(counts.n) === total`
是折叠完备性不变量（harness 断言）。

## scope 速览

- **recent**：System+Application 的 warn/error 汇总，最常用的开场查询
- **boot**：kind=all 查官方重启排查清单（启停标记 12/13/6005/6006/6009、
  意外重启 41/6008、蓝屏 1001、重启原因 1074/19/7045）∪ WHEA-Logger 硬件错误；
  kind=unexpected 只查 41/6008；kind=bluescreen 查 1001 + WHEA-Logger
- **crash**：Application 通道 1000（应用崩溃）/1001（WER）/1002（无响应）/
  1026（.NET Runtime）/33·35（SideBySide 并行配置）；`app` 按消息子串过滤
- **service**：System 通道 SCM 白名单 18 个 ID（全 Error 级，见下"终验"）；
  `name` 按消息子串过滤
- **disk**：System 通道 7/11/51（坏块/控制器/分页）、129/153（超时重试）、
  55/98/50/140（Ntfs 损坏/写失败）、157（掉盘）
- **security**：4624 成功登录 / 4625 登录失败 / 4740 锁定；域环境 Kerberos
  失败（4771）不覆盖（维修场景定界）
- **query**：覆盖长尾的自定义查询，ids 下推 + provider/msg 后置过滤
- **detail**：按 recordId 直取单条完整原文（保留换行，20k 字符封顶并标记）；
  或按 id 取该 ID 最近一条

## 实现

全部逻辑在 `eventlog-core.ts`（零依赖，直连 harness `tests/_t9.mjs`/`_t10.mjs`
可导入）；`eventlog.ts` 只做注册与 schema。

### 下推与多组 OR

`FilterHashtable` 下推 LogName / Level / StartTime / Id / ProviderName。
Level 用数组表达"最低级别档"：warn=@(1,2,3)（Critical/Error/Warning）、
error=@(1,2)。boot 需要（ID 白名单）OR（WHEA-Logger 提供者），而
FilterHashtable 跨字段只能 AND——按组下推后流式去重（`$seen` 按
logName/recordId），合并后统一时间倒序取全局 top。每组最多物化 top 条，
内存不随命中量增长。

### 后置过滤（pwsh 侧）

ID 白名单已下推，后置量小。`msgLike`（crash.app / service.name / query.msg）
用 `IndexOf OrdinalIgnoreCase`——无正则、零回溯风险；`providerRe`（query.provider）
用 `[regex]::new(pattern, IgnoreCase, 1s)`——MatchTimeout 防灾难性回溯，
编译失败结构化上报为 `{ error }`。带 msgLike 的查询需渲染全部下推命中记录的
消息（crash/service 量小，可接受）。

### $Error 分类（语言无关判据）

枚举必须 `SilentlyContinue`：毒事件（provider 消息资源损坏，
`EventLogException`，坏机器常见）会被自动跳过，其余照常返回；
`ErrorActionPreference='Stop'` 会把整条查询炸掉。之后按异常类型与
FullyQualifiedErrorId 分类：`EventLogException` → unreadable 计数；
`NoMatchingEventsFound` / `NoMatchingProvidersFound` /
`LogsAndProvidersDontOverlap` → 条件级零命中（后两者给固定码
provider-not-found / provider-log-mismatch 供 notice 提示，模型可区分
"provider 写错"与"确实没事件"）；其余（NoMatchingLogsFound 等）→
结构性错误，收敛 `{ error }`。

### security 的显式 admin 预检

实测：非管理员下 FilterHashtable 查 Security **静默返回 0 条**
（NoMatchingEventsFound），并不报拒绝访问。若只靠错误分类，"没权限"会
伪装成"没有登录事件"。因此 security 先做 `isAdminPwsh()`（一次 pwsh 调用，
进程内缓存）预检，非管理员直接返回 `admin:false + degraded:true + notice`，
不执行查询、不伪造空结果。

### detail 的单条直取

recordId 模式：`Get-WinEvent -LogName X -FilterXPath '*[System[(EventRecordID=N)]]' -MaxEvents 1`
——XPath 元素名是 `EventRecordID`（PS 属性叫 RecordId）。模板写死、仅插入
整数校验后的 recordId，与 FilterHashtable 的插值同安全模型，模型可控
过滤表达式仍然为零。id 模式：FilterHashtable LogName+Id + MaxEvents 1
（取最近一条）。

### 体积收敛（三条硬规则）

1. top=100 上限，时间倒序（组内枚举天然倒序；多组合并后按
   time desc + recordId desc 排序，同秒确定性）
2. 重复折叠：counts 来源/ID 计数表（n 降序，100 组封顶，超出计数
   countsTruncated=true）
3. 简述截 200 字符（pwsh 与 Node 双侧同规则、幂等，超出补 …），全文留给 detail

最坏体积 ≈ 100 条 × ~300B + 计数表 ≈ 十几 KB，与机器健康状况无关。

## 取舍

| 决策 | 备选 | 理由 |
|---|---|---|
| 枚举 SilentlyContinue + $Error 分类 | ErrorActionPreference=Stop | 毒事件（消息资源损坏）在 Stop 下炸掉整条查询；SilentlyContinue 自动跳过毒记录，实测 30d System 2934 条中 121 条毒事件被跳过、查询存活 |
| FQID/异常类型分类零命中 | 解析错误消息文本 | 错误消息随系统语言本地化；FullyQualifiedErrorId 的 ID 部分与异常类型名是语言无关的 |
| security 显式 admin 预检 | 依赖错误分类 | 实测非管理员 FilterHashtable 查 Security 静默返回 0 条——不预检会把"没权限"伪装成"没有登录事件" |
| boot 多组 OR + $seen 去重 | 单组正则后置 | ID 白名单与 WHEA 都能精确下推，后置正则无法享受下推；WHEA 声明的 ID 19 与白名单重叠，去重是真实需要的 |
| provider 正则带 MatchTimeout | 裸 -match | 模型输入的正则可能灾难性回溯；1 秒超时 + try/catch 有界 |
| msgLike 用 IndexOf | [regex]::Escape + -match | 子串匹配无正则语义，IndexOf 零回溯风险且更快 |
| detail 用 EventRecordID XPath | 全通道枚举后过滤 | FilterHashtable 不支持 RecordId；XPath 模板写死仅插整数，等价安全模型 |
| 后置过滤只允许单组 | 多组各自带过滤 | 多组去重与后置过滤叠加的语义复杂化；现实需求（boot）不需要 |
| 原文 20k 字符封顶 | 无上限 | WER 报告消息可达数十 KB；单条输出有界 |
| counts 100 组封顶 | 无上限 | 病态 query 组合（30d 全通道多 ID）的组数有界，notice 说明 |

## 实测排除的坑（2026-09-03，pwsh 7.6.5）

- 毒事件：部分 provider 消息资源损坏（"找不到映像文件中指定的资源类型"，
  `EventLogException`），Stop 下炸查询，SilentlyContinue 下自动跳过
- Security 非管理员：FilterHashtable 形态静默 0 条，`-LogName` 直查才报
  UnauthorizedAccessException——必须显式预检
- XPath 元素名是 `EventRecordID`，不是 PS 属性名 `RecordId`
- SCM 提供者声明 ID 带 0xC0000000/0xA0000000/0x80000000/0x40000000 高位
  编码（severity 在高位），解码后才是真实事件 ID；SCM 不声明
  Level.DisplayName；7025 本机表未声明（按设计保留）；7045 被声明为
  Information 级但保留在 boot 白名单（恶意服务持久化线索）
- WHEA 提供者精确名是 `Microsoft-Windows-WHEA-Logger`（下推必须全名）
- 事件 ID 0 是合法 ID（hcmon 实测 386 条/30d）
- 体积实测：24h warn+err（System+Application）117 条 402ms；30d 全级别
  4218 条 4.5s；30d 全级别 System 2934 条含 121 毒事件正常收敛

## 已知限制

- security 仅覆盖本地/工作组登录审计；域环境 Kerberos 失败（4771）不报
  （维修场景定界，见 event_design.md）
- 事件 ID 白名单是"相关事件"清单而非全部故障事件：冷门故障仍需 scope=query 长尾覆盖
- boot 的 19（WindowsUpdateClient 安装成功）与 WHEA-19 无法在结果里区分来源组，
  靠 provider 字段自行判读
- 消息文本随系统语言本地化（本机中文），模型跨机器解读时注意；级别已固定
  英文映射（Critical/Error/Warning/Information）不受影响
- 带后置过滤的查询（crash.app / service.name / query.msg / query.provider）
  需渲染全部下推命中记录的消息，量级由 ID 白名单兜住；query 的过滤词过宽
  时耗时随命中量增长（超时 30s 兜底）
- 无消息文本的事件 msg 为 null（正常，部分系统事件无渲染模板）
- 刷屏机器的速率陷阱：单组占绝对主导（counts.n ≈ total）且 events 时间戳挤在极短时间内时，日志正被高速灌屏，时间窗内更早的记录已被滚动清除——total 不能当整个时间窗的均匀累计去算平均速率（2026-09-03 真机实测：WHEA-Logger/17 约 3000 条/分钟，System 30d 窗口 12,272 条全在 4 分钟内；模型把 total 除以 30 天得出千分之一量级的假速率）
- 同因：被灌爆的日志上 boot 的启停标记（6005/6006）恒为 0——不是系统不记录，是旧记录被滚出窗口。span 字段（窗口内实际覆盖时间）落地前靠 events 时间戳分布判读
