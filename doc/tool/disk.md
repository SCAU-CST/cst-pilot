# disk — 存储分析工具

实现：`agent\home\extensions\disk.ts`。PRD 对应"存储分析"缺口（已交付）。

## 背景

存储是维修场景的第一大主题：C 盘红盘、盘剩多少、这块盘是不是要坏、
哪些东西能删。这是 cst-pilot 的第一个自研扩展，runPwsh、降级包装、
返回结构等模式从这里定型，被后续工具复用。

## 调用方式

`disk` 对外只注册一个工具名，`scope` 参数选子功能：

| scope | 查什么 | 数据源 | 管理员 | 实测耗时 |
|---|---|---|---|---|
| `space` | 各盘剩多少空间 | Node `statfsSync`，零子进程 | 否 | <0.1s |
| `info` | 盘的型号/类型/健康状态 | pwsh：`Get-PhysicalDisk` + `Win32_LogicalDisk` | 否 | ~3.7s |
| `health` | SMART 可靠性数据（寿命/温度/通电小时） | pwsh：`Get-StorageReliabilityCounter` | 是 | —（降级） |
| `usage` | 目录占用排行、大文件、可清理项 | WizTree MFT 直读 → 降级 node 逐文件 walk | 否（实测） | ~0.7s |

以下实例均为真实运行输出（`_t4.mjs` 抓取）。

## LLM 收到的提示词（逐字实录）

系统提示词 `Available tools:` 列表中的行：

```
- disk: Query disk space, drive info, health, and directory usage ranking (read-only)
```

系统提示词 `Guidelines:` 中的条目：

```
- Use disk when the user asks about disk space, capacity, free space, drive models, drive health, or which folders take the most space.
- For usage ranking on large paths (whole drives), expect slower response under normal privileges; results may be lower bounds.
```

Function schema（每次请求的 tools 数组中）：

```jsonc
{
  "name": "disk",
  "description": "获取磁盘/卷的结构化只读信息：空间（总量/剩余/占用率）、物理盘基本信息（型号/SSD或HDD/NVMe或SATA或USB/健康状态）、SMART 可靠性数据（寿命磨损/温度/通电小时，需要管理员权限，失败时自动降级并说明）、目录占用排行 usage（一次返回四张表：目录排行 topDirs、单个大文件 topFiles、按扩展名聚合 extAgg、一年未动的大文件 staleFiles；管理员走 WizTree 秒级全扫，普通权限走逐文件统计较慢）。不做任何修改。",
  "parameters": {
    "type": "object",
    "required": ["scope"],
    "properties": {
      "scope": { "type": "string", "enum": ["space", "info", "health", "usage", "all"] },
      "drive": { "type": "string", "description": "scope=space/info/health 可选，限定盘符，如 \"C\" 或 \"C:\\"。省略则返回全部卷。" },
      "path":  { "type": "string", "description": "scope=usage 必填。要分析的目录或盘符，如 \"C:\\\\"、\"C:\\\\Users\"。整个目录树会被统计。" },
      "top":   { "type": "number", "description": "scope=usage 可选，返回占用最大的前 N 个目录，默认 20，上限 100。" }
    }
  }
}
```

注意：`description` 是模型了解 scope 语义的唯一来源——五个 scope 的含义、
四张表的字段名全部写在这段话里。

## scope=space：各盘空间

```
disk({ scope: "space" })
```

```jsonc
{
  "space": [
    { "drive": "C:", "totalGB": 299.1, "freeGB": 104.8, "usedPct": 65 },
    { "drive": "D:", "totalGB": 300,   "freeGB": 73.5,  "usedPct": 75.5 },
    { "drive": "E:", "totalGB": 331.2, "freeGB": 80,    "usedPct": 75.8 }
    // F: G: （后略）
  ]
}
```

## scope=info：物理盘与逻辑卷

```
disk({ scope: "info" })
```

```jsonc
{
  "physicalDisks": [
    {
      "FriendlyName": "Samsung SSD 970 EVO 1TB",
      "SerialNumber": "0025_3852_0151_5382.",
      "MediaType": "SSD",              // SSD / HDD
      "BusType": "NVMe",               // NVMe / SATA / USB
      "HealthStatus": "Healthy",
      "OperationalStatus": "OK",
      "sizeGB": 931.5
    }
    // 第二块盘（后略）
  ],
  "volumes": [
    { "drive": "C:", "label": "",        "fs": "NTFS", "driveType": "Fixed", "totalGB": 299.1, "freeGB": 104.8 },
    { "drive": "D:", "label": "Software","fs": "NTFS", "driveType": "Fixed", "totalGB": 300,   "freeGB": 73.5 }
    // E: F: G:（后略）
  ]
}
```

`driveType` 已从 Windows 的数字码翻译成可读词（Fixed/Removable/Network/Optical），
模型不需要知道 3 是什么意思。

## scope=health：SMART（非管理员的降级形态）

```
disk({ scope: "health", drive: "C" })
```

非管理员下实测返回：

```jsonc
{
  "smart": null,
  "smartNotice": "SMART 数据需要管理员权限。当前以普通权限运行，已降级。如需寿命/温度数据，请以管理员身份重新启动 pi。"
}
```

管理员下 `smart` 是记录数组：磨损度（Wear）、温度、通电小时、读写错误计数。
权限失败不是工具失败——其余 scope 照常工作。

## scope=usage：占用分析（四张表一次返回）

```
disk({ scope: "usage", path: "E:\\Learning\\Programming\\cst-pilot\\doc", top: 5 })
```

```jsonc
{
  "usage": {
    "method": "wiztree-mft",
    "root": "E:\\Learning\\Programming\\cst-pilot\\doc",
    "totalGB": 0.000029,               // 小目录自动提升精度，不显示假 0
    "topDirs": [                        // ① 目录排行
      { "path": "...\\doc\\tool\\",   "sizeGB": 0.000022, "pct": 74.5 },
      { "path": "...\\doc\\design\\", "sizeGB": 0.000005, "pct": 16.9 }
    ],
    "topFiles": [                       // ② 单个大文件
      { "path": "...\\doc\\tool\\sys.md", "sizeGB": 0.000007, "pct": 23 }
      // （后略）
    ],
    "extAgg": [                         // ③ 按扩展名聚合
      { "ext": "md", "files": 7, "sizeGB": 0.000029 }
    ],
    "staleFiles": [],                   // ④ ≥50MB 且 ≥1 年未动的文件（本例无）
    "notice": "WizTree 全量 MFT 导出（10 行，其中文件 7 个）。topDirs=目录排行；topFiles=单个大文件；extAgg=按扩展名聚合（含文件数）；staleFiles=≥50MB 且 ≥1 年未修改的文件（大者优先）。全部只读统计。"
  }
}
```

## 实现

### usage 快速路径：WizTree 直读 MFT

MFT（NTFS Master File Table，主文件表）记录卷上所有文件的位置与大小。
WizTree 便携版（仓库自带）直读 MFT，全盘秒级，实测普通权限也可用（`/admin=0`）。
导出 CSV 后流式解析，一次遍历产出四张表。

**表头无关解析**：WizTree 的 CSV 表头随系统语言变化（中文系统出中文表头）。
解析按行首正则 `^"(.+)",(\d+),` 取路径和字节，目录行以路径尾分隔符区分，
完全不读表头。staleFiles 的日期同理：格式带不带引号不稳定，
用宽松正则从行内搜日期而非按列号定位。

**topKeeper 恒定内存**：116 万行流式解析时不攒全量排序。
Top-N 账本只留 N 个元素：新项低于末位门槛直接丢弃（大多数行的命运），
否则替换末位重排。内存不随数据量增长。

**顺手喂账本**：usage 扫描的数据正是 wz-index 账本需要的，
流式解析时逐行入账——ls 之后查同盘任意路径秒回。这是两个扩展共享账本的起因。

**GB 数值自适应精度**：格式化函数 `fmtGB2` 常规值保留两位小数
（如 0.02GB ≈ 21MB）；真实数据小到两位归零时自动提升到 4~6 位小数
（如 38KB 显示为 0.000035），绝不把非零数据显示成 0。

### 降级路径：node-walk

无 WizTree / 建账失败时逐文件 stat 累加，50 万条目熔断，
结果标注下界，并记录 `degradedFrom` 告知降级原因。

## 取舍

| 决策 | 备选 | 理由 |
|---|---|---|
| WizTree 便携版 | 自研 MFT 解析 / systeminformation | 自研 MFT 解析要对付 NTFS 结构细节和版本差异；WizTree 秒级且可随仓库分发 |
| 表头无关解析 | 读表头定位列 | 表头随语言变，读表头在中文系统必挂 |
| topKeeper 流式 Top-N | 全量收集后排序 | 116 万行不能进内存 |
| usage 顺手喂账本 | 两扩展各扫各的 | 同一份数据，零额外成本复用 |
| 盘符白名单校验 | 信任模型输入 | drive 参数正则限定单字母 A-Z，其余拒绝，杜绝注入面 |
| health 失败降级不报错 | 整体失败 | 权限不足时用户仍需要 info/space 的结果 |

## 已知限制

- health 在非管理员下降级，无提权引导（SMART 提权方案 B 待拍板）
- walk 降级路径慢（大目录分钟级），且结果是下界
- WizTree 扫描结果有秒级时效偏差，对维修场景无影响
