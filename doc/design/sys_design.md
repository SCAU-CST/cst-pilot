# Design — sys 系统检查工具

对应 `doc\PRD.md`，R1–R5 逐条落位，已全部实现（2026-09-01）。

## TLDR

`sys`：实时负载 + 传感器检查，辅助维修人员现场定位
"谁在吃资源"。单工具多 scope，沿用 disk 已验证的模式。
调用方是模型：一份描述省 token，
一套返回结构（`data / notice / error`）学一次用全部。
与 disk 边界一句话：盘上归 disk，运行归 sys。

## 选型

A 单工具多 scope / B 每域一工具 / C 全量快照 → **A**。

- 描述常驻系统提示词，B 白烧 5 份
- C 把最贵路径（双采样、GPU 计数器）绑死在每次调用
- disk 已验证该模式，模型零学习成本

## 接口

```
sys({ scope?, top? })
│
├─ top?=10   上限 50，仅 proc / gpu / io 生效
│
├─ overview    整机负载概况（R4）—— 无 scope 兜底
│              内存池（驱动泄漏）+ 机型（厂商/型号/CPU/BIOS）
├─ proc        内存 + CPU% Top N + 可执行路径（R1）
├─ gpu         每进程 GPU 利用率 + 显存（R2）
│              独显附温度 / 功耗；
│              无 NVIDIA 时 LHM 附核显 / 其他卡传感器；
│              适配器清单（含虚拟显示，计数器偶发失败重试 1 次）
├─ io          每盘队列 / 吞吐 + 每进程 IO 速率（覆盖面复盘 T1）
└─ sensor      温度 / 风扇 / 电压（R3；计数器失败透出 counterErrors）
```

R5 剥离为独立工具 `startup.ts`：配置盘点与实时负载不同类，
无共享采集逻辑，塞进 scope 只会让边界变模糊。

## 架构

外部缝一条，复杂度全在实现内：

```
sys({ scope, top })
│
├─ sys.ts   路由 + 参数校验 + 结果包装
│
├─ collectProc()      快照 + 双采样
├─ collectGpu()       计数器聚合 + nvidia-smi
├─ collectIo()        进程 IO 差分 + 每盘队列
├─ collectSensor()    LHM + 提权降级
├─ collectOverview()
├─ lhmGpuStatus()     无 NVIDIA 时的核显降级路径
└─ runPwsh / 超时 / 解析   ← 共享设施
```
`collectX()` 仅供实现与直连 harness（`_t*.mjs`）测试。

## 采集要点

- proc：CPU% 双采样差分；
  不走 PerfProc 原始表（实测 7.8s）；
  附 `path`（Get-Process 现成字段，系统进程 / 无权限时为 null）
- gpu：GPU Engine 按进程聚合（偶发无效采样重试 1 次再收敛 {error}）；
  Process Memory 取显存；nvidia-smi 存在才附带；
  无 NVIDIA 时 LHM 只开 GPU 附 `lhmGpu`（原始传感器读数，
  部分老核显可能为空——语义区别于 nvidia: null，notice 说明）；
  适配器清单取 Win32_VideoController（<0.1s 并入同命令，
  bus=PCI/ROOT 供模型区分实体卡与虚拟显示，不硬编码谁是真卡）
- io：每进程 IO 取 Win32_Process 累计计数双快照差分
  （避开 PerfProc 慢路径）；每盘取 PerfDisk_PhysicalDisk
  格式化计数器类双读（类名不本地化）；两路共用同一采样窗口
- sensor：LHM 0.9.6 用户态（`lhm\`）+ Thermal Zone
  + 降频计数器，免安装免管理员；
  CPU 核心温度需内核驱动，零安装约束下用降频信号替代；
  计数器失败透出 counterErrors（机器可能没有这类计数器，重试无判据）
- overview：纯快照（CPU 占用率除外，双读差分）；
  内存池取 PerfOS_Memory 即时值；机型取 ComputerSystem/BIOS/
  Processor 现成字段，按机型匹配已知问题是品牌机维修第一步

## 边界

- 盘上归 `disk`（容量 / SMART），运行归 `sys`（负载）；
  "现在谁在读写"归 sys scope=io（实时吞吐），
  disk 管"东西占了多少、盘体本身健康吗"
- `startup` 管"开机拉起什么"（静态配置），
  `sys` 管"现在什么在吃资源"（实时负载）
- 磁盘温度归 `sensor`（数据源是传感器，非 SMART）

## 里程碑

- [x] proc —— 2026-09-01，`tests/_t3.mjs`
- [x] gpu —— 2026-09-01，同上
- [x] overview + 无 scope 兜底 —— 2026-09-01，`tests/_t7.mjs`
- [x] sensor + `lhm\` 打包 —— 2026-09-01，`tests/_t3`/`_t6`；
      UAC 实测确认核心温度需内核驱动，降频信号替代
- [x] startup 剥离为独立工具 —— 2026-09-01，`tests/_t8.mjs`
- [x] io —— 2026-09-03，`tests/_t11.mjs`（Todo 覆盖面复盘 T1）
- [x] gpu 无 NVIDIA 时 LHM 降级（lhmGpu）—— 2026-09-03，同上（T2）
- [x] proc 附加可执行路径 —— 2026-09-03，同上（T3）
- [x] gpu 附适配器清单 + 计数器重试 —— 2026-09-03，同上（T4/T6；
      T6 的 schema 拦截评估结论：pi-ai 报错已含路径/原因/参数回显，不改）
- [x] overview 内存池 + 机型 —— 2026-09-03，同上（T5/T7）

## 待拍板（已全部落定）

- [x] `top` 默认 10，上限 50
- [x] 无 scope 兜底 `overview`
- [x] `startup` 剥离为独立工具，不进 sys scope
