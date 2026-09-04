# 环境测试：设备形态

对应 Testlist「Windows 设备」维度。执行结构：① README 全量工具检测组 B01–B31；② 本文档差异项。

## 建议测试机画像

| 形态 | 画像 |
|---|---|
| 组装机 | 散件自装，无 OEM 预装 |
| 品牌台式机 | 联想/戴尔/惠普/方正任一，带 OEM 预装软件 |
| 笔记本 | 华硕/联想/机械革命/惠普任一，含双显卡机型优先 |
| 一体机 | 台式平台 + 内置显示器 |
| 老旧机器 | i3/i5-4xxx~7xxx + 机械盘 + Win10 |

## 差异测试项

| # | 需求 | Agent 调用 | Reviewer pwsh 核查 | 判据 |
|---|---|---|---|---|
| D01 | 厂商机型识别 | sys `overview` | `Win32_ComputerSystem/BIOS` 对数 | vendor/model 与实体铭牌一致；组装机可为空 |
| D02 | OEM 预装自启 | startup 全量 | Run 键 + 服务交叉 | 第三方自启 path 指向非 System32 |
| D03 | 双显卡判读 | sys `gpu` | `Win32_VideoController` 对数 | adapters 含 bus=PCI 实体卡；bus=ROOT/USB 判为虚拟 |
| D04 | 一体机外设链 | driver `external` | `Win32_PnPEntity` 显示/USB 抽查 | 内置屏在清单或解释性说明 |
| D05 | 机械盘 IO 特征 | sys `io` | `Get-Counter` 同盘对照 | busyPct/queueLen 语义正确；碎片化提示如实 |
| D06 | 老旧驱动痕迹 | driver `problem` | 设备管理器状态码对照 | 异常设备带错误码原样透传 |
| D07 | 老机器自启服务噪声 | startup 全量 | `Win32_Service` Auto 项计数 | 服务数与系统世代匹配，无报错 |
