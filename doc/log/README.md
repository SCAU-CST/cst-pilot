# 使用情况遥测 · 管线

状态：骨架，未实现。更新：2026-09-19。

log 系统是工具包使用数据的收集管线：发送端在队员机器上采集并上报，接收端在队伍服务器上存储，供查询与报表。

采什么、不采什么由数据契约决定，见 [../schema.md](../schema.md)。本文档只管「怎么传、怎么存」，不重复契约内容。

| 文件 | 内容 |
|---|---|
| [schema.md](../schema.md) | 数据契约：请求记录与会话记录的字段与口径 |
| [sender/SPEC.md](sender/SPEC.md) | 发送端：采集、上报、降级、配置 |
| [receiver/SPEC.md](receiver/SPEC.md) | 接收端：接口、存储、报表 |

## 议题

| 组 | 主题 | 位置 |
|---|---|---|
| S1–S3 | 数据字段与口径 | [schema.md](../schema.md) |
| M1–M7 | 发送端机制 | [sender/SPEC.md](sender/SPEC.md) |
| R1–R15 | 接收端接口、存储、鉴权、保留期、报表 | [receiver/SPEC.md](receiver/SPEC.md) |

已定结论写进正文，未决项留在各文档议题表。
