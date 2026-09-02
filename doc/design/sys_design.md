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
├─ top?=10   上限 50，仅 proc / gpu 生效
│
├─ overview    整机负载概况（R4）—— 无 scope 兜底
├─ proc        内存 + CPU% Top N（R1）
├─ gpu         每进程 GPU 利用率 + 显存
│              独显附温度 / 功耗（R2）
└─ sensor      温度 / 风扇 / 电压（R3）
```

R5 剥离为独立工具 `startup.ts`：配置盘点与实时负载不同类，
无共享采集逻辑，塞进 scope 只会让边界变模糊。

## 架构

外部缝一条，复杂度全在实现内：

```
┌──────────────────────────────────────────┐
│ 接口：sys { scope, top }                  │
├──────────────────────────────────────────┤
│ sys.ts   路由 + 参数校验 + 结果包装         │
│  ├─ collectProc()    快照 + 双采样         │
│  ├─ collectGpu()     计数器聚合 + nvidia-smi│
│  ├─ collectSensor()  LHM + 提权降级        │
│  ├─ collectOverview()                    │
│  └─ runPwsh / 超时 / 解析   ← 共享设施      │
└──────────────────────────────────────────┘
```

`collectX()` 仅供实现与直连 harness（`_t*.mjs`）测试。

## 采集要点

- proc：CPU% 双采样差分；
  不走 PerfProc 原始表（实测 7.8s）
- gpu：GPU Engine 按进程聚合；
  Process Memory 取显存；nvidia-smi 存在才附带
- sensor：LHM 0.9.6 用户态（`lhm\`）+ Thermal Zone
  + 降频计数器，免安装免管理员；
  CPU 核心温度需内核驱动，零安装约束下用降频信号替代
- overview：纯快照，无采样

## 边界

- 盘上归 `disk`（容量 / SMART），运行归 `sys`（负载）
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

## 待拍板（已全部落定）

- [x] `top` 默认 10，上限 50
- [x] 无 scope 兜底 `overview`
- [x] `startup` 剥离为独立工具，不进 sys scope
