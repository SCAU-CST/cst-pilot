# wz-index — 跨扩展共享的 WizTree 大小账本

实现：`agent\home\extensions\wz-index.ts`。**不是工具**，是 ls 与 disk 共享的模块。
没有它，两个扩展会各自维护一套全盘大小数据，重复扫描。

## 背景

ls 和 disk 的 usage scope 都需要"全盘每个目录多大"这份数据：

- disk usage 为了出四张排行表，必须做全量 MFT 扫描
- ls 只需要目标目录的直接子项大小，但独立获取同样要全盘扫描

同一台机器、同一个盘，扫两次是纯浪费。账本把两者接起来：
**谁扫全盘，谁喂账；谁要子项，谁查账。**

## 实现

### 数据结构

```
WzStore
├─ dirs : Map<盘符, Map<规范化路径, 字节>>     全量目录行
└─ files: Map<盘符, Map<规范化路径, 字节>>     ≥1MB 文件行
```

- 规范化 = 绝对路径 + 大写 + 去尾分隔符（Windows 路径大小写不敏感）
- 文件行只收 ≥1MB：账本用途是"假 0 / stat 失败兜底"，小文件无兜底价值，
  全收会让 Map 膨胀到百万级
- 盘符为键：同进程只缓存已扫过的盘，跨盘互不干扰

### globalThis 单例

pi 的扩展加载器对每个扩展文件**独立编译**，各文件 import 到的模块实例
不保证是同一个——普通的模块级 `const store` 会裂成两份。

解法：`globalThis.__wzIndexStore ??= {...}`，进程级单例。

### 数据流

```
disk usage 扫描 ──流式解析──> addDirLine/addFileLine ──> store
                                                              │
ls 查询 ──> ensureIndex(target) ──有账──> dirs/files Map ──────┘
                │
                └─缺账─> buildIndex(drive) ──WizTree 全盘导出──> 入账
```

### failedDrives：失败不重试

WizTree 不存在或建账失败的盘，记入 `failedDrives`，本进程内不再尝试。
否则每次 ls 都要撞一遍 180 秒超时，交互完全不可用。

## 取舍

| 决策 | 备选 | 理由 |
|---|---|---|
| 进程内 Map，不落盘 | SQLite / JSON 文件 | 便携工具包场景写盘有痕迹；重启后重建的成本（一次扫描）可接受 |
| 只入账 MFT 数据 | walk 降级数据也入 | walk 是熔断下界，入账等于永久污染；账本的质量约定是"只收全量真值" |
| 文件账只收 ≥1MB | 全量文件 | 兜底场景只需大文件（pagefile.sys 等）；内存换价值 |
| UNC 路径不索引 | 网络盘也扫 | WizTree 对网络共享无 MFT 快速路径，退化为慢速扫描，不值得 |
| 空 factory 默认导出 | 让加载器报错 | pi 会把 extensions\ 下所有 .ts 当扩展入口；空 factory 让共享模块安静加载 |

## 与 WizTree 的关系

WizTree 是仓库自带的便携版第三方工具（`wiztree\WizTree64.exe`），
本模块只是它的导出结果的解析器与缓存。

- 导出通过命令行参数（`/export=csv`），无 UI
- 临时 CSV 写 `wiztree\tmp`，用完即删（唯一的写路径）
- 表头无关解析的原因见 disk.md

## 已知限制

- 账本不感知文件系统变化：扫描后新建/删除的文件不会反映，
  直到下次全盘重建。维修场景（几分钟内的诊断会话）可接受
- 账本无淘汰机制：内存占用随扫描过的盘数线性增长，单盘约几十 MB
- `buildIndex` 失败原因不区分（无 WizTree / 超时 / 解析失败），统一进 failedDrives
