# 测试方法总纲

覆盖 `Testlist.md` 全部环境的公共测试方法。各环境的差异项见同目录 `env-*.md`。

## 角色分工（交叉验证）

| 角色 | 行为 |
|---|---|
| Agent（邻居 pi 实例） | 只通过本项目工具回答，如实报告返回与 notice |
| Reviewer（开发者/审查者） | 用自由 pwsh 命令核查同一场景，与 Agent 结果对照 |

Reviewer 的 pwsh 命令不限于工具实现方式（可用 CIM、直读注册表、独立计时等），目的是独立取得第二份事实。两边结论冲突时，以 Reviewer 的独立核查为准并记录为工具缺陷。

## 执行结构（每个环境相同）

1. **全量工具检测**：执行下表 B01–B31（六工具全部 scope）
2. **环境差异项**：执行对应 `env-*.md` 的差异表

## 全量工具检测组（B01–B31）

设备无关：判据为结构断言与自洽闭环，不预设机器数值，不要求特定硬件存在。`<Win>` = `%SystemRoot%`，`<Kit>` = 便携版自身目录，`<Sys>` = 系统盘，`<Vol>` = 便携版所在卷根。

**disk（7 条）**

| # | 调用 | 判据 |
|---|---|---|
| B01 | `scope=space` 全卷 | 覆盖全部本地卷，free≤total，多文件系统字段正确 |
| B02 | `info`（`<Kit>` 所在盘；无独立卷则并入 B01） | physicalDisks 与 volumes 对应，盘类型译名在枚举内 |
| B03 | `health <Sys>` | 权限双分支均通过：非 admin → smart:null+notice；admin → 结构完整 |
| B04 | `usage <Kit> top=10` | topDirs/topFiles/extAgg/staleFiles 齐全，量级与实际一致 |
| B05 | `usage <Win>\WinSxS top=5` 连调两次 | 第二次显著更快（账本热态） |
| B06 | `usage` 不存在路径 | 明确 error，不崩溃不挂起 |
| B07 | `all`（组合 scope） | space+info+health 三块齐全 |

**ls（3 条）**

| # | 调用 | 判据 |
|---|---|---|
| B08 | `ls <Kit>\pwsh top=15` | 账本热路径秒回，omitted 正确 |
| B09 | `ls <Win>\WinSxS top=10` | B05 建账后秒回；不同卷时即跨盘账本隔离验证 |
| B10 | `ls <Vol>\` 盘根 | 盘根混合内容正常枚举 |

**sys（5 条）**

| # | 调用 | 判据 |
|---|---|---|
| B11 | `overview` | cpu∈[0,100]，mem.used≤total，machine 结构齐全 |
| B12 | `proc top=15` | 双采样差分；byCpu/byMem ≤15 条 |
| B13 | `gpu` | adapters≥1；nvidia:null 合法；lhmGpu 仅无 N 卡时出现且可空 |
| B14 | `sensor` | 结构正确，counterErrors 如实；传感器可空 |
| B15 | `io` 连调两次 | 首调冷耗时记录，第二次更快 |

**startup（1 条）**

| # | 调用 | 判据 |
|---|---|---|
| B16 | 全量 | regItems/startupFolders/services 齐全，disabled 三态 |

**driver（6 条）**

| # | 调用 | 判据 |
|---|---|---|
| B17 | `problem` | 空清单合法，结构齐全 |
| B18 | `core` | 网/蓝/音/显通道结构返回 |
| B19 | `external` | USB/显示器结构返回 |
| B20 | `find class=Net` → 取一台 deviceId 子串 → `find id=子串` | 原设备必命中（转义与双通道闭环） |
| B21 | `find name+class` 双条件复查 B20 目标 | 结果 ⊆ 仅 name 结果集（AND 语义） |
| B22 | `find` 无参数 | 明确报错"至少传一个" |

**eventlog（9 条）**

| # | 调用 | 判据 |
|---|---|---|
| B23 | `recent hours=48` | 时间倒序，counts 折叠完备 |
| B24 | `boot kind=bluescreen` | span 字段存在，sum(counts.n)=total |
| B25 | `crash` | 结构齐全，msg 含故障模块语义；空命中合法 |
| B26 | `service` | SCM 白名单结构正确；7045 含义区分 |
| B27 | `disk` | 7/11/51/129/153 等结构正确；空命中合法 |
| B28 | `query ids=[41] logName=System top=20` | 通用 ID 查询完成，折叠完备；命中与否如实 |
| B29 | `detail` 取 B23-B28 任一样本 recordId | id/provider/recordId 与样本一致（闭环） |
| B30 | `security` | 非 admin：degraded:true+notice；admin：结构完整，双分支均通过 |
| B31 | `security type=lockout`（或 logonFail） | type 过滤生效语义；空命中合法 |

## 通过标准与记录约定

1. 每条记录：Agent 关键返回、Reviewer 核查值、一致/偏差结论、耗时
2. 降级（notice/degradedFrom/degraded:true）不算失败，如实记录
3. 硬件缺失（无独显/无蓝牙/无温度计）不算失败
4. 只读原则：不修改机主数据；工具自身的账本与索引写入属正常行为
5. 表格精简，细节写行下备注

## 已知缺陷跟踪

| 缺陷 | 状态 |
|---|---|
| FAT32 卷 disk usage 的 method 仍报 wiztree-mft | 已修复（2026-09-04，按卷类型标注，见 Notice.md） |
| disk info 的 drive 参数未生效（返回全部盘，代码确认未实现） | 已修复（完整版双过滤：卷按盘符、物理盘按分区关联；e2e 13/13） |
| eventlog crash 不区分 provider/level（VMware 1000 误报） | 已修复（Error 级硬滤 + atypical 软标注；真崩溃样本待测试机复核） |
