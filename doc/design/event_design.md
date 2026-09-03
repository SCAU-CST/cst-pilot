# Design — eventlog 事件日志工具


## TLDR

维修场景的故障线索（意外关机、蓝屏、崩溃、服务失败）
都沉淀在事件日志里，目前只能手动翻。
新增 `eventlog` 工具让 pi 直接读取并汇总。
单工具多 scope（sys 同构）、`runPwsh()` + `Get-WinEvent`、
只读、返回 `data / notice / error`。

## 接口

TS 语法：`?` 可选，`|` 枚举。
「写死」= 常量在代码里，模型不可改。
无全局覆盖模式：每个分支自含全部参数，
允许什么、写死什么，看分支即可。

```
event({ scope, ... })
│
├─ scope="recent"    兜底：近 N 小时错误 / 警告汇总
│   ├─ level?= "warn"(默认) | "error"   最低级别
│   ├─ hours?=24    top?=100
│   └─ logName 写死: System + Application
│
├─ scope="boot"      意外关机 / 蓝屏 / 开关机历史
│   ├─ kind?= "all"(默认) | "unexpected" | "bluescreen"
│   │            unexpected → 41·6008
│   │            bluescreen → 1001 + WHEA-Logger
│   ├─ hours?=24    top?=100
│   ├─ logName 写死: System
│   └─ ID 白名单写死（官方重启排查清单）:
│        12·13·6005·6006·6009    内核 / 事件服务启停标记
│        41·6008·1001            意外重启与蓝屏详情
│        1074·19·7045            重启原因：人为 / 更新 / 新装服务
│        + WHEA-Logger            硬件错误报告
│
├─ scope="crash"     应用崩溃 / 启动失败，含故障模块名
│   ├─ app?: 程序名 / 模块名模糊过滤
│   ├─ hours?=24    top?=100
│   ├─ logName 写死: Application
│   └─ ID 白名单写死:
│        1000·1001·1002     崩溃 / WER / 无响应（官方崩溃文档）
│        1026               .NET Runtime 启动即崩
│        33·35 (SideBySide) 并行配置不正确，老软件打不开
│
├─ scope="service"   服务异常：启动失败/挂起/崩溃/未正常关闭
│   ├─ name?: 服务名模糊过滤
│   ├─ hours?=24    top?=100
│   ├─ logName 写死: System
│   └─ ID 白名单写死（对 SCM 提供者全表交叉核对）:
│        7000·7001·7002·7003        启动失败（含依赖 / 组）
│        7013·7038·7041              账户密码 / 登录失败 / 权限不足
│        7009·7011·7022              超时 / 挂起
│        7023·7024·7031·7032·7034   异常终止（7032 = 恢复动作也失败）
│        7043                        未正常关闭
│        7025·7026                   启动期汇总 / 驱动加载失败
│
├─ scope="disk"      磁盘 / 文件系统报错
│   ├─ hours?=24    top?=100
│   ├─ logName 写死: System
│   └─ ID 白名单写死:
│        7·11·51                 坏块 / 控制器 / 分页错误
│        129·153                 超时重试，坏盘前兆
│        55·98·50·140 (Ntfs)     文件系统损坏 / 写失败
│        157                     非可移动盘被意外移除（掉盘）
│
├─ scope="security"  登录审计（需管理员，无权限 notice 降级）
│   ├─ type?= "all"(默认) | "logonFail" | "lockout"
│   │            logonFail → 4625    lockout → 4740
│   ├─ hours?=24    top?=100
│   ├─ logName 写死: Security
│   └─ ID 白名单写死: 4624·4625·4740
│
├─ scope="query"     自定义查询，覆盖长尾
│   ├─ ids?: number[]
│   ├─ level?: 枚举，同 recent
│   ├─ provider?: 正则校验后 -match
│   ├─ msg?: 消息子串，pwsh 侧后置
│   ├─ hours?=24    top?=100
│   └─ logName?: 任意通道，默认 System + Application
│
└─ scope="detail"    单条详情与原文
    ├─ recordId? 或 id?   二选一必传，id 取最近一条
    └─ logName 必传（无预设）
```

- `hours` / `top` 各分支语义相同，故重复列出；
  `logName` 不是可覆盖的全局参数，
  仅 `query`（可选）和 `detail`（必传）拥有它
- 白名单来源分级：boot/disk 清单取自微软官方排查文档；
  service 对 SCM 提供者全量事件表逐条核对（7000–7045），
  明确不收：一次性配置类（7005–7008·7012–7021·7027–7030·7033·7037）
  与信息 / 提示级（7035·7036·7039·7040·7042·7044）；
  crash 的 1026/33/35 为启动失败场景补充
  （官方崩溃文档仅含 1000/1001）
- 1001 双重身份：System 通道 = BugCheck（归 boot），
  Application 通道 = WER（归 crash）；两 scope 通道互斥，无冲突
- security 覆盖工作组/本地场景；域环境的 Kerberos 失败
  （4771）不覆盖【维修场景不涉及，已定边界】
- 模糊过滤 pwsh 侧后置 `-match`，ID 白名单已下推，后置量小

## 返回与体积

无法预知命中量（坏机器一天可刷上千条 WER），三条硬规则：

- `top=100` 上限，时间倒序
- 重复折叠：`data` 附 来源/ID 计数表
  （`SCM/7034 × 37，最近 10:32`）
- 简述截 200 字符，全文留给 `detail`

`data.total` + `notice` 说明截断。
最坏 100 条 × ~300B + 聚合表 ≈ 十几 KB，与机器健康状况无关。
默认 warn 后噪音上升，由折叠计数表兜住——
警告刷屏机器上模型看到的是「N 条重复」而不是 N 行。

## 采集与安全

- `FilterHashtable` 下推：
  LogName / Level / StartTime / Id / ProviderName
- 注入防护：模型输入只进结构化字段，逐个白名单校验；
  不做 `FilterXml` / 裸 XPath；命令串写死（仓库约定）
- 管理员：Security 无权限时 `notice` 降级，其余照常（sys 模式）

## 边界

- vs `sys`：sys 管实时负载，event 管历史痕迹
- vs `disk`：SMART 是硬件自身健康，event 是系统视角 I/O 异常
- 日志清理 / 保存 / 配置：一律不做，只读

## 里程碑

编号即顺序，1–2 是地基，后续 scope 逐个端到端；
每步均按 sys 惯例用直连 harness（`tests/_t*.mjs`）验证。

- [x] 1. 核心链路：runPwsh + Get-WinEvent 下推
       （LogName / Level / StartTime / Id / ProviderName）
       —— 2026-09-03，tests/_t9.mjs。实测：下推全部可用，Level 接受数组
       （warn=@(1,2,3) / error=@(1,2)）；默认时间倒序；枚举必须
       SilentlyContinue（毒事件=EventLogException 被跳过，Stop 会炸整条查询），
       零命中与 provider 未匹配按 FQID 语言无关判据吸收（详见 core 文件头）
- [x] 2. 返回与体积：top / 来源·ID 折叠计数表 /
       200 字符截断 / data.total + notice
       —— 2026-09-03，tests/_t9.mjs。折叠不变量 sum(counts.n)==total 实测成立；
       注入校验（logNames/ids/providers 白名单拒绝 + 数字夹紧）全绿
- [x] 3. `recent`（首个端到端 scope，含缺省兜底）
       —— 2026-09-03，tests/_t10.mjs（无 scope 兜底 recent；level 默认 warn）
- [x] 4. `boot` / `crash`：主力场景，白名单已对官方文档核定
       —— 2026-09-03，tests/_t10.mjs。WHEA 精确名 = Microsoft-Windows-WHEA-Logger
       （下推用全名），其声明 ID 19 与白名单 19 重叠 → boot 多组 OR +
       $seen（logName/recordId）去重落地；crash 消息子串过滤实测
- [x] 5. `service` / `disk`：白名单落地；
       service 用本机 SCM 提供者反查事件 ID 作终验
       —— 2026-09-03，tests/_t10.mjs。SCM ListProvider 全表交叉核对通过
       （声明 ID 高位编码 0xC0000000+N，解码后白名单全 Error 级；7025 本机表
       未声明，按设计保留；排除项 7035/7036/7039/7040/7042/7044 确为信息级）
- [x] 6. `query`：结构化自定义查询 + 逐字段注入校验
       —— 2026-09-03，tests/_t10.mjs。provider 正则带 1s MatchTimeout
       （防灾难性回溯，编译失败结构化上报）；msg 用 IndexOf
       OrdinalIgnoreCase（零回溯）；ids/level/logName 白名单校验
- [x] 7. `detail`：recordId / id 直取原文
       —— 2026-09-03，tests/_t10.mjs。recordId 走 EventRecordID XPath 模板
       （PS 属性叫 RecordId，XML 元素是 EventRecordID）；模板写死、仅插入整数
       校验后的值，与 FilterHashtable 插值同安全模型，无模型可控过滤表达式；
       原文保留换行，20k 字符封顶并标记
- [x] 8. `security`【已拍板本期实现（2026-09-03）】：权限降级实测
       —— tests/_t10.mjs。关键实测：非管理员下 FilterHashtable 查 Security
       会静默返回 0 条（NoMatchingEventsFound）而非报拒绝访问 ——
       若只靠错误分类，「没权限」会伪装成「没有登录事件」；
       故 security 做显式 admin 预检（isAdminPwsh，进程内缓存）后 notice 降级
- [ ] 9. 收尾：doc/tool/eventlog.md + PRD 更新 + 工具描述打磨
