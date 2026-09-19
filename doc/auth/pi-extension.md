# pi 扩展技术方案

状态：草案。更新：2026-09-19。

对应 [OA 授权与令牌](README.md) 的 M1。实现范围：cst-pilot 发行版内的 pi 扩展。

## 结论

1. 独立扩展，目录 agent/home/extensions/oauth/，与 diagnostics 平级，不改 pi 内核。
2. 扩展负责：设备标识、设备流登录、令牌查询与刷新、任务选择、网关 provider 注入、状态命令。
3. 二维码引入单文件 MIT 库（vendored），登记 THIRD-PARTY-NOTICES；不引其他依赖。
4. 启动前刷新放在 pi.cmd 调用的 node 脚本；会话内交互由扩展负责；两者共用同一模块。

## 目录结构

```
agent/home/extensions/oauth/
|-- index.ts          扩展入口：命令注册与事件订阅
|-- device.ts         设备标识读写（agent/home/device.json）
|-- flow.ts           设备授权流：申请、轮询、超时
|-- tokens.ts         令牌存储与刷新
|-- provider.ts       网关 provider 注入
|-- tasks.ts          任务列表与选择
|-- qr.ts             二维码渲染（TUI）
|-- vendor/qrcode.js  vendored 单文件库（MIT）
`-- package.json
```

## 登录流程（/cst-login）

1. 读取或生成 device.json。
2. POST /api/oauth/device_authorization，取 user_code 与 verification_uri。
3. TUI 渲染二维码与 6 位数字码；宽度不足时只显示链接。
4. 按 interval 轮询；超过 5 分钟提示重新开始。
5. 成功后写 access_token；记住模式另写 refresh token。
6. 失败按 RFC 8628 错误码给出中文提示。

## 令牌与刷新

| 项 | 规则 |
|---|---|
| 检查时机 | 每次请求前检查 exp |
| 提前刷新 | 距过期小于 5 分钟触发 |
| 静默刷新 | 有 refresh token 时自动完成 |
| 无 refresh | 提示执行 /cst-login |
| 401 或 403 | 清理本地令牌，提示重新登录 |

## 任务与会话（M1）

1. /cst-task 列出本人任务。
2. 选择后 POST /api/agent/repair-sessions 创建会话。
3. 会话号与任务号写入会话文件，供审计与日志关联。
4. 会话结束调用关闭流程；M2 起在关闭时提交日志草稿。

## 网关 provider 注入

1. 登录或刷新后 POST /api/agent/gateway-key 领取短期令牌。
2. 写入 agent/home/models.json 的 provider（cstoa-gateway）。
3. key 过期前自动换新并更新配置。
4. 不覆盖用户自建 provider。

待核实：pi 是否支持扩展运行时热更新 provider。不支持时降级为「启动前刷新，会话内提示重启生效」。

## 凭据存储

| 文件 | 内容 | 说明 |
|---|---|---|
| agent/home/device.json | device_id、设备名、首次运行时间 | 不含秘密 |
| agent/home/auth.json | pi 凭据（access token） | 沿用 pi 机制 |
| agent/home/cst-refresh.json | refresh token（记住模式） | 明文，默认不生成 |

1. 日志不打印完整令牌，最多前 6 位。
2. /cst-logout 清理本地文件并调用 revoke。

## 错误处理

| 场景 | 行为 |
|---|---|
| 授权被拒 | 提示已拒绝，重新执行 /cst-login |
| 扫码超时 | 提示重新开始 |
| 网络失败 | 提示检查网络，无离线模式 |
| 设备被吊销 | 清理凭据，提示重新授权或联系管理员 |
| TOTP 校验失败 | 授权页内提示，agent 保持轮询 |
| 额度不足 | 提示额度不足，不自动重试 |

## 二维码渲染

1. 首选 vendored 单文件库，输出块字符画。
2. 终端宽度不足 60 列时退回「链接 + 6 位数字码」。
3. Web 端（后续）渲染 SVG 或 canvas。

## 打包与合规

1. pack.mjs 整目录复制 extensions/，无需白名单改动。
2. 新增第三方库登记 THIRD-PARTY-NOTICES。
3. pi.cmd 注释更新：说明 OAuth 与离线开关的关系。

## 测试用例

| 用例 | 说明 |
|---|---|
| 首次授权 | 全新 U 盘：扫码 → 选任务 → 模型可用 |
| 拒绝 | 授权页拒绝后收到 access_denied |
| 超时 | 5 分钟未确认，提示重新开始 |
| 刷新 | 记住模式下 access 过期自动刷新 |
| 吊销 | 个人中心吊销后请求被拒并清理本地 |
| 改密 | 改密后旧令牌立即失效 |
| 断网 | 明确的网络错误提示 |
| 窄终端 | 无二维码时的文本回退 |

## 待核实

| 编号 | 事项 |
|---|---|
| V1 | pi 扩展的 provider 与凭据热更新能力 |
| V2 | 命令注册与二维码输出的挂载点 |
| V3 | Web 端二维码组件的复用方式 |
