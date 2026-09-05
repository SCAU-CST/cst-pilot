# 工具代码正确性审查

审查日期：2026-09-05。基线：当前工作区，HEAD `0737efd4889661308722771c93a016b129adcb82`。开始时已有 `doc/test/Testlist.md` 未提交修改，未改动该文件。

结论：发现 22 项代码正确性问题，其中 3 项 P1、19 项 P2。最先应处理两处 PowerShell 参数注入，以及采集失败返回正常空结果的问题。现有实现不能据此判定为正确。

本次阅读了六个工具及共享模块（`sys`、`startup`、`driver`、`eventlog`、`disk`、`ls`、两个 core 与 `wz-index`）、启动器、相关设计和测试代码。仅进行代码审查和小样例验证，不运行现有集成测试、全盘扫描或中大规模测试，不修改实现。Windows 10 以下不在范围内；未进行需求覆盖审计或实机兼容性认证。

证据说明：**脚本复现**为直接调用原函数，或在内存中加载原代码并替换外部数据源；**静态确认**为可从控制流直接推导的问题，其触发环境未实机搭建；**平台依据**为核对了官方说明。验证脚本通过标准输入运行，没有落盘，没有删除文件。注入验证仅在子 PowerShell 进程中设置内存标记，系统查询函数被替换为空函数。

## 优先修复

### 01 · P1 · driver 名称参数可以执行额外 PowerShell 语句

位置：[driver-core.ts:175](E:/Learning/Programming/cst-pilot/agent/home/extensions/driver-core.ts:175)、[driver-core.ts:181](E:/Learning/Programming/cst-pilot/agent/home/extensions/driver-core.ts:181)。证据：脚本复现。

`RE_NAME` 允许单引号、分号和 `$`，`escapeWqlStr` 只处理双引号，最终整个 WQL 又被直接放进 PowerShell 单引号字符串。普通名称中的 `'` 就能破坏命令；构造输入可以突破只读工具边界，以当前进程权限执行额外语句。

无害验证输入 `x'; $global:reviewMarker=123; #` 通过现有名称正则。将真实构建函数产出的命令交给 PowerShell，并替换 CIM 查询为空函数，仍输出 `REVIEW_MARKER=123`。后续 JSON 解析即使失败，也不能撤销已经执行的语句。

建议将参数作为数据传递给固定脚本；WQL 字面量与 PowerShell 字面量必须分别处理，不能认为内层转义会保护外层。

### 02 · P1 · eventlog 的单引号转义漏掉 Unicode 引号

位置：[eventlog-core.ts:313](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:313)、[eventlog-core.ts:316](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:316)。证据：脚本复现。

`msgLike` 与 `providerRe` 直接进入单引号脚本字符串，仅将 ASCII `'` 翻倍。PowerShell 也识别弯单引号作为字符串定界符，输入校验没有阻止这一字符。

使用 `msgLike = "x’; $global:reviewMarker=456; #"`，经过原 `buildSpec` 和 `buildEventQueryCmd`，在空事件源下仍输出 `REVIEW_MARKER=456`。此路径对应工具的 `query.msg`，会执行额外语句。包含自然语言弯引号的普通过滤词也可能导致解析失败。

建议固定脚本，通过 JSON/stdin 等数据通道接收过滤词。若继续生成脚本文本，必须覆盖 PowerShell 实际识别的定界符；仅改用 `-EncodedCommand` 不会修复脚本内容中的注入。

### 03 · P1 · CIM 查询失败被包装成正常空清单

位置：[driver-core.ts:122](E:/Learning/Programming/cst-pilot/agent/home/extensions/driver-core.ts:122)、[driver-core.ts:145](E:/Learning/Programming/cst-pilot/agent/home/extensions/driver-core.ts:145)；同类模式见 [startup.ts:81](E:/Learning/Programming/cst-pilot/agent/home/extensions/startup.ts:81)、[sys.ts:304](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:304)。证据：driver 路径脚本复现，其余静态确认。

查询模板设置 `SilentlyContinue`，之后不检查采集错误，继续输出 JSON。`runPwsh` 收到可解析 JSON 就认为成功。权限拒绝、CIM provider 不可用或裁剪系统缺少组件时，设备枚举失败会表现为“没有异常设备”，服务枚举失败会表现为空清单。

把 `Get-CimInstance` 替换成只执行 `Write-Error` 的函数，运行原 `CMD_PROBLEM` 与 `runPwsh`，得到 `{ devices: [], count: 0 }`，没有采集失败标记。

建议按数据源捕获错误，并保留其他查询的成功结果；“空结果”和“未能采集”必须有不同的返回状态。

## 功能与查询结果

### 04 · P2 · crash 只要传 app 就无法查询

位置：[eventlog-core.ts:858](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:858)、[eventlog-core.ts:285](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:285)。证据：脚本复现。

`crash` 构造两个查询组，并把 `app` 放进两组的 `msgLike`；命令构建器明确禁止多组带后置过滤。直接调用 `runScope({scope:'crash', app:'chrome'})` 返回 `多组查询不支持 msgLike/providerRe 后置过滤`，尚未执行系统查询。

建议让多个查询组共享同一个消息过滤条件，或分别执行、合并去重；保留统一 top 与计数语义。

### 05 · P2 · crash 的级别过滤排除了 WER 1001

位置：[eventlog-core.ts:586](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:586)、[eventlog-core.ts:858](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:858)。证据：本机单条元数据读取与静态确认。

1001 被归入仅接受 Critical/Error 的组。本机用精确 provider、ID 和 `MaxEvents=1` 读取到 `{Id:1001, Level:4, ProviderName:'Windows Error Reporting'}`，因此这类正常 WER 报告会被排除，尽管工具描述承诺包含 WER 1001。未读取或输出该事件的消息正文。

建议按 provider + ID 分组过滤，为 WER 保留其实际级别；不能为排除第三方 Information 1000 而对 1001 一并压级别。

### 06 · P2 · driver 的 hardwareIds 匹配被前置 DeviceID 过滤截断

位置：[driver-core.ts:177](E:/Learning/Programming/cst-pilot/agent/home/extensions/driver-core.ts:177)、[driver-core.ts:307](E:/Learning/Programming/cst-pilot/agent/home/extensions/driver-core.ts:307)。证据：原命令构建函数输出与静态确认。

`collectFind` 将 `id` 传入 `buildFindCmd`，后者生成 `DeviceID LIKE ...`。仅在 `hardwareIds` 中出现、但不在 `DeviceID` 中出现的子串，会使设备在 WQL 阶段就被排除，后面的双通道 Node 过滤无法找回。代码注释声称不下推，实际仍在下推。

建议只下推 name/class，id 在返回设备集合上执行现有 `deviceId OR hardwareIds` 匹配。

### 07 · P2 · disk info 的单条 JSON 分支跳过规范化与盘符过滤

位置：[disk.ts:453](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:453)、[disk.ts:459](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:459)。证据：PowerShell 序列化与原 execute 的内存样例复现。

管道 `ConvertTo-Json` 在只有一条结果时输出对象，代码却只在物理盘和逻辑卷均为数组时过滤。单物理盘、C/D 两卷的样例中，查询 `info drive=C` 仍返回 C/D 两卷，物理盘保持原始对象与 `Size`，也没有未过滤提示。关联只有一条时，还会被误认为查询失败。

建议在解析边界统一零条/单条/多条形态，区分错误对象，再执行映射与过滤。

### 08 · P2 · disk health 接受 drive，但完全没有使用

位置：[disk.ts:497](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:497)。证据：原 execute 的内存样例复现。

`SMART_CMD` 枚举全部物理盘，health 分支没有任何盘符映射或过滤。两盘样例中，调用 `health drive=C` 返回两块盘的温度。调用者据此回答“C 盘健康”时，可能引用另一块盘。

建议先解析目标卷对应的物理设备集合，再限制可靠性查询；无法建立关联时明确说明，不能静默忽略参数。

### 09 · P2 · 同名自启项的禁用状态相互覆盖

位置：[startup.ts:104](E:/Learning/Programming/cst-pilot/agent/home/extensions/startup.ts:104)、[startup.ts:116](E:/Learning/Programming/cst-pilot/agent/home/extensions/startup.ts:116)。证据：静态确认。

HKCU/HKLM、Run/Run32/StartupFolder 的状态全部写入 `$dis[$n]`，只用名称作为键。两个来源存在同名项且状态不同时，后读到的状态覆盖前者，之后所有同名项都使用最后一个值。RunOnce 也可能错误继承同名 Run 项的状态。

建议用用户/机器范围、启动类别和名称组成键，并按每个条目的真实来源查询对应 StartupApproved 项。

### 10 · P2 · GPU 引擎百分比相加，可能输出 130% 等伪总利用率

位置：[sys.ts:181](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:181)。证据：原 GPU 模板的内存样例复现与平台依据。

同一进程的不同引擎可以并行工作，直接求和不是单个 GPU 的总体忙碌百分比。向原模板提供同 PID 的 3D=70、Copy=60 两条样本，输出 `gpuPct=130`；当前代码还把不同 GPU 的引擎混在同一个 PID 组里。

建议保留适配器与引擎身份，分别展示；如要提供与任务管理器相近的单一利用率，应采用明确的最繁忙引擎口径。微软说明任务管理器使用最繁忙引擎代表总体利用率：[DirectX 官方说明](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager//)。

### 11 · P2 · 多张 NVIDIA 卡只返回第一张状态

位置：[sys.ts:213](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:213)。证据：静态确认。

`nvidia-smi --query-gpu` 的 CSV 输出按 GPU 分行，解析代码只取 `split(...)[0]`。多 NVIDIA 卡机器上，后续卡的温度、功耗和显存被直接丢弃；适配器清单虽可能包含多卡，状态结果没有说明遗漏。

建议解析全部行，并查询 UUID 或 PCI bus ID，将状态与对应适配器关联。

### 12 · P2 · 已满磁盘的 freeGB 被转换成 null

位置：[disk.ts:95](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:95)、[disk.ts:492](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:492)。证据：原 execute 的内存样例复现。

`fmtGB` 只接受 `bytes > 0`，因此可靠数据 `FreeSpace=0` 会输出 `freeGB:null`。真正没有可用空间与未知空间被合并，恰好影响磁盘写满这一维修场景。

建议保留合法零值，仅把缺失或非法数值转换为 null。

## 环境、降级与错误处理

### 13 · P2 · 只读介质上的临时目录创建失败绕过降级

位置：[disk.ts:209](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:209)、[wz-index.ts:90](E:/Learning/Programming/cst-pilot/agent/home/extensions/wz-index.ts:90)。证据：disk 路径注入 EACCES 复现，共享索引路径静态确认。

两个 `mkdirSync(WIZTREE_TMP)` 都在 try 外。随包 WizTree 存在，但 tmp 尚未创建且介质只读、目录无权限或介质不可访问时，异常向上抛出，`disk usage` 无法进入 Node 回退，`ls` 也无法进入其回退路径。

建议把临时目录准备纳入错误收敛，失败后返回降级原因。这里的触发条件是目录准备失败；已有可访问 tmp 时不一定在 mkdir 阶段失败。

### 14 · P2 · 英文性能计数器路径在其他语言环境中会失效

位置：[sys.ts:136](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:136)、[sys.ts:402](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:402)、[sys.ts:420](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:420)。证据：静态确认与平台依据，未运行语言系统矩阵。

GPU、热区和频率查询硬编码英文计数器路径，热区字段筛选又依赖英文名称。计数器名称会本地化，因而在相应名称被翻译的系统上，字段可能存在却查询失败。重复同一英文查询不能解决此问题。

建议按计数器标识解析本地化名称，或使用可行的语言无关接口。微软明确说明该行为：[Get-Counter 文档](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-counter?view=powershell-7.6)。

### 15 · P2 · GPU 计数器失败导致独立数据源的成功结果也丢失

位置：[sys.ts:278](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:278)。证据：原 `collectGpu` 的内存样例复现。

GPU Engine 两次失败后直接返回 error，即使并行的 `nvidiaStatus` 已成功也被丢弃；LHM 回退也不会运行，适配器枚举位于计数器成功之后。老驱动、缺失计数器或本地化失配，会连带让本可获得的显卡温度/型号不可见。

给数据源分别注入“计数器失败”和 `{name:'mock NVIDIA',tempC:45}`，原函数只返回计数器错误。建议将适配器、计数器和硬件传感器独立采集、按来源标明失败。

### 16 · P2 · 工具包路径带单引号时 LHM 脚本无法解析

位置：[sys.ts:234](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:234)、[sys.ts:364](E:/Learning/Programming/cst-pilot/agent/home/extensions/sys.ts:364)。证据：PowerShell 解析器复现。

`LHM_DLL` 直接插入 `Add-Type -Path '${LHM_DLL}'`。工具包放在合法路径 `E:\Tim's kit\...` 时，生成脚本产生字符串未闭合和 try/catch 解析错误。错误发生于脚本解析阶段，内部的 try/catch 无法处理。

建议通过参数数据通道传入路径；保留模板插值时也必须使用正确的 PowerShell 字面量编码。

### 17 · P2 · SMART 的任意后端错误都被解释成非管理员

位置：[disk.ts:499](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:499)。证据：原 execute 的内存样例复现。

权限拒绝、pwsh 不存在、超时、存储模块缺失或设备不支持等全部变成“当前以普通权限运行”。代码没有检查实际身份或错误类型。注入普通后端错误，同样返回管理员重启提示，原始原因完全丢失。

建议仅对已识别的权限错误提供提权提示，其他失败保留来源和原因；逐盘失败也应避免掩盖其他盘的结果。

### 18 · P2 · 管理员探测失败被永久缓存成非管理员

位置：[eventlog-core.ts:624](E:/Learning/Programming/cst-pilot/agent/home/extensions/eventlog-core.ts:624)。证据：静态确认。

预检只有 10 秒超时，随后 `adminCache = r === true` 把 `{error:...}` 也变成 false。慢介质冷启动、运行时暂时失败后，整个进程后续都不会再次预检，并一直声称没有管理员权限，即使进程实际已提升。

建议只有得到真实布尔结果才写入身份缓存；探测错误单独返回，允许后续重试。

## 目录统计与移动介质

### 19 · P2 · 换入占用同一盘符的介质会继续使用旧账本

位置：[wz-index.ts:137](E:/Learning/Programming/cst-pilot/agent/home/extensions/wz-index.ts:137)、[disk.ts:168](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:168)。证据：静态确认，未实机拔插。

目录、文件大小和文件系统缓存都只用盘符作为身份，没有卷标识或失效机制。会话中先查询 F: 的介质 A，再换入仍分配为 F: 的介质 B，`ensureIndex` 因已有 F: 账本而跳过重建。同名目录可返回 A 的大小；文件系统缓存也可能将新的 exFAT 卷继续标成 NTFS。

建议使用卷身份校验缓存，身份变化时整体更换账本与文件系统信息，并记录采样时间；失败记录也不应跨不同介质继承。

### 20 · P2 · ls 的时间/数量熔断不能停止目录递归

位置：[ls.ts:56](E:/Learning/Programming/cst-pilot/agent/home/extensions/ls.ts:56)、[ls.ts:63](E:/Learning/Programming/cst-pilot/agent/home/extensions/ls.ts:63)。证据：原 `walkSize` 的内存目录样例复现。

预算只在非目录分支检查。到期后仍递归每个子目录；遇到文件也只是 continue，继续枚举后续条目。大量小目录或慢网络目录中，所谓 30 秒上限不能停止工作。以 `deadline=0` 调用原函数，三层纯目录样例仍执行三次 readdir 并返回 `complete:true`。

建议在进入目录及每轮枚举前检查共享预算，耗尽后立即向上返回不完整状态；这只能阻止继续调度，不能保证中断已经阻塞的单次文件系统调用。

### 21 · P2 · ls 无法 stat 的条目被标成完整的 0 B 文件

位置：[ls.ts:145](E:/Learning/Programming/cst-pilot/agent/home/extensions/ls.ts:145)。证据：静态确认。

同步与异步 stat 都失败且账本无记录时，代码添加 `{type:'file',bytes:0}`。设置 `incomplete` 又要求 `s?.isDirectory()` 为真，此时 s 为 null，因此不会提示缺失。受限目录、断开的链接或枚举后消失的项都可能被错报为正常零字节文件，并影响总量和百分比。

建议对无法判定类型/大小的条目保留未知状态，并标记统计不完整；异步 stat 若恢复成功且为文件，应使用其实际 size。

### 22 · P2 · usage 根路径未规范化，导致总量和占比失配

位置：[disk.ts:225](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:225)、[disk.ts:252](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:252)、[disk.ts:510](E:/Learning/Programming/cst-pilot/agent/home/extensions/disk.ts:510)。证据：静态确认。

输入只 trim，内部 norm 只去尾分隔符、转大写。对 `path='.'`、含 `..` 的路径或正斜杠路径，输入表示与 WizTree 的绝对反斜杠 CSV 路径不同。若 WizTree 成功扫描，根行匹配失败，`totalGB/pct` 为 null，根目录还会进入 topDirs。路径实际可访问并不能保证字符串形式一致。

建议入口统一 resolve/normalize，并对 CSV 路径采用同一规范化函数后比较。

## 验证边界与修复顺序

本次证据来自原代码的局部执行、故障注入、PowerShell 解析器、单条 WER 元数据和两份微软文档；没有据此宣称在 FAT32/exFAT、SD 卡、PE 或全部 Windows 10/11 版本上实测通过。特殊环境结论仅落在具体代码分支：只读目录准备、介质换盘缓存、慢启动身份探测、本地化计数器、缺失数据源的错误传播。

建议先修复 01–03，恢复参数边界与采集结果可信度；随后处理 04–09、12、15 等直接影响查询结论的错误。其余按目标环境和使用频率安排。当前无需先全面重构 PowerShell 实现，但每个输入进入脚本的层级、每个数据源的失败状态都应有明确处理。

## 修复完成记录

以上 22 项已逐项修复。正文保留审查时的原行为与基线行号，当前状态以本节为准。

| 编号 | 修复后相对原实现的变化 |
|---|---|
| 01、02、16 | 输入字符串与 LHM 路径编码为数据表达式；ASCII/弯引号不再进入脚本语法。 |
| 03 | sys、driver、startup 保留采集错误并标记 degraded；失败不再表现为正常空清单。 |
| 04、05 | crash 的 app 过滤应用于所有分组；按提供程序和 ID 配对，WER/Hang 保留原始级别。 |
| 06 | 名称与 ID 按字面子串匹配，硬件 ID 命中不再被 DeviceID 预筛丢弃。 |
| 07、08、12 | 磁盘单条结果统一数组；info/health 按目标盘筛选；剩余 0 字节保留为 0。 |
| 09 | 自启禁用状态按注册表根、类别、名称匹配；RunOnce 不误用 Run 状态。 |
| 10、11、15 | GPU 利用率取最繁忙引擎并保留样本；NVIDIA 返回每卡状态数组；计数器失败不丢弃其他数据源。 |
| 13、19 | 临时目录创建失败进入降级；缓存复用和发布前检查卷身份，换盘或身份不可得时丢弃缓存。 |
| 14 | GPU/传感器计数器经 Windows PDH 转换为本地化路径，不依赖固定英文路径或 Perflib 名称表。 |
| 17、18 | SMART 保留部分结果与真实错误，仅权限拒绝提示提权；管理员探测失败不缓存为非管理员。 |
| 20、21、22 | 目录遍历预算同时约束目录和文件；无法读取的条目保留未知，重试成功使用实际大小；usage 统一规范化输入与 CSV 路径。 |

验证：`tests/review-fixes.mjs` 的 16 组局部探针全部通过，覆盖上述问题、故障注入和生成的 PowerShell 模板解析。脚本位于项目原有忽略目录，仅作本地验证；不执行系统扫描或文件删除。另在本机用 PDH 解析四条计数器路径成功。未运行中大规模测试，未宣称已在各类特殊介质或全部 Windows 10/11 版本实测。
