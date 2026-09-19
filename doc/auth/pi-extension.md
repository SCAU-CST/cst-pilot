# pi 扩展技术方案

状态：草案。更新：2026-09-19。

对应 [OA 授权与令牌](README.md) 的 M1。实现范围：cst-pilot 发行版内的 pi 扩展。

## 结论

1. 用 pi 原生的自定义 provider OAuth 机制实现：扩展通过 `pi.registerProvider("cstoa", { oauth })` 注册。
2. 登录界面、凭据存储、自动刷新都由 pi 负责；扩展只实现 `login` 与 `refreshToken` 两个回调。
3. 模型流量走 OA 代理（方案 S）：provider 的 `baseUrl` 指向 OA 的 OpenAI 兼容端点，`getApiKey` 返回 OA 访问令牌。
4. 登录界面用 pi 原生设备码界面（可点击 URL + 6 位数字码）。二维码暂不做，见上游讨论。
5. 扩展额外维护两样东西：设备标识与 OA 访问令牌缓存（供 `/api/agent/*` 调用）。

## 与 pi 原生能力的分工

| 事项 | 负责方 |
|---|---|
| 登录界面（URL、6 位数字码） | pi，`onDeviceCode` 回调 |
| 凭据存储与自动刷新 | pi，`auth.json`（0600）与 `refreshToken` 回调 |
| 设备码轮询 | 扩展。pi 的 `@earendil-works/pi-ai/oauth` 只导出类型，未导出轮询工具 |
| 任务选择、日志等 OA API 调用 | 扩展 |
| 二维码 | 暂不做。上游暂无提案，按贡献规范走 issue 流程 |

## 扩展结构

```
agent/home/extensions/oauth/
|-- index.ts       入口：registerProvider 与命令注册
|-- oa.ts          OA 设备流与令牌交换（login/refresh）
|-- device.ts      设备标识（agent/home/device.json）
|-- tasks.ts       任务列表与选择
`-- package.json
```

## 登录与刷新

1. `/login` 选择 "CSTOA OA"，pi 调用扩展的 `login(callbacks)`。
2. `login`：POST `/api/oauth/device_authorization`，然后用 `callbacks.onDeviceCode({ userCode, verificationUri, intervalSeconds, expiresInSeconds })` 交给 pi 展示。
3. 按 interval 轮询 `/api/oauth/token`，成功后返回 `{ access, refresh, expires }`。
4. pi 把凭据写入 `auth.json`；临近过期时自动调用 `refreshToken(credentials, signal)`。
5. 刷新走 OA 的 refresh grant，轮换令牌；失败则提示重新 `/login`。

约定：

1. 默认每场扫码时不返回 refresh，凭据过期即要求重新登录。
2. 开启「记住 7 天」时返回 refresh，由 pi 持久化与轮换。

## 模型调用（方案 S）

| provider 字段 | 值 |
|---|---|
| baseUrl | https://cstoa.top/api/agent/llm/v1 |
| api | OpenAI 兼容 |
| models | 网关可用模型清单，与 OA 约定 |
| oauth.getApiKey | `(credentials) => credentials.access` |

1. OA 代理端点校验 `llm:chat` 作用域与额度，转发到 New API 并记录审计。
2. 流式响应按 OpenAI 兼容格式透传。

## OA API 调用（任务与日志）

1. 登录与刷新回调里同步写 `agent/home/cst-oa.json`（0600），缓存当前 OA 访问令牌与过期时间。
2. 调 `/api/agent/*` 前检查有效期；收到 401 或 403 时提示重新登录。
3. 任务绑定（M1）：`/cst-task` 列出本人任务，选择后创建修机会话。

## 错误处理

| 场景 | 行为 |
|---|---|
| 授权被拒 | 提示已拒绝，重新执行 /login |
| 扫码超时 | 提示重新开始 |
| 网络失败 | 提示检查网络，无离线模式 |
| 设备被吊销 | 刷新或请求被拒后提示重新授权或联系管理员 |
| 额度不足 | 提示额度不足，不自动重试 |

## 打包与合规

1. pack.mjs 整目录复制 extensions/，无需白名单改动。
2. M1 不引入第三方库（二维码暂不做）。
3. pi.cmd 注释更新：说明 OAuth 与离线开关的关系。

## 测试用例

| 用例 | 说明 |
|---|---|
| 首次授权 | 全新 U 盘：/login → 扫码 → 选任务 → 模型可用 |
| 拒绝 | 授权页拒绝后收到 access_denied |
| 超时 | 5 分钟未确认，提示重新开始 |
| 刷新 | 记住模式下 pi 自动刷新 |
| 吊销 | 个人中心吊销后请求被拒并提示重新登录 |
| 改密 | 改密后旧令牌立即失效 |
| 额度不足 | 代理端点返回额度错误，界面提示 |
| 断网 | 明确的网络错误提示 |

## 待核实

| 编号 | 事项 |
|---|---|
| V1 | 扩展能否读回 pi 的当前凭据（决定 cst-oa.json 是否必要） |
| V2 | 命令注册与刷新提示的最佳挂载点 |
