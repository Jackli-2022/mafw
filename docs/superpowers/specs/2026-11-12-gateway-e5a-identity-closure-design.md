# Gateway E5a 身份闭环：设计（2026-11-12）

> 来源：58 项清单中的 **A2（human-only 判定）+ A13（per-device 凭据）**。目标：把"人类动作"从"没带 actorSessionID"的隐式约定，升级为**显式人类凭据**；把移动端从共享网关 token 升级为**可撤销的设备凭据**；为 E5b（C1 事件恢复源）和 E6（交互模型）打身份底座。

## 1. 意图

当前两类身份缺口：

1. **A2**：pod accept、review items、decision 确认、standing-goal 批准等"人类专属"动作，判定是 `body.actorSessionID` 存在 → 403，缺省 → 人类。任何 agent/内部 HTTP 只要不带 actorSessionID，就被当成人类；这是审计提示，不是认证。
2. **A13**：移动端配对链接明文携带**网关共享 apiToken**（`orcalore://pair?...&token=<apiToken>`），设备没有独立凭据；设备列表里的 `apiTokenHash` 是 FCM token 的 hash，不是可验证的设备凭据；删除设备不能撤销访问。

E5a 引入三类 principal：

| principal | 凭据 | 能做什么 |
|---|---|---|
| `human` | 本机 human token / 移动设备 device token | 普通 API + **human-only 动作** |
| `service` | 共享 `server.apiToken` | 普通 API（agent/MCP/系统），**不能** human-only |
| `local` | loopback 且无凭据 | 普通 API（兼容旧客户端），**不能** human-only |

关键翻转：**"没有 actorSessionID" 不再等于人类**；human-only 必须有 human/device 凭据。

## 2. 非目标

- 不做 C1 event_log 恢复源 / mobile 游标（→ E5b）。
- 不做 desktop 单点扇出 / 单一实体缓存 / 事件增量 / mobile 增量（→ E6）。
- 不做 OS 级沙箱或 per-owner fencing：human token 与 gateway 同属一个 OS 用户，恶意本地进程仍可读取；E5a 防的是 **agent 误触/误调用**，不是本机恶意代码。
- 不轮换共享 apiToken，不改 runtime 契约，不改 MCP 工具集。
- 不做设备管理 UI 的新交互（沿用现有 devices list/delete）。
- 不引入 OAuth/OIDC；移动端不走浏览器。

## 3. Principal 与认证

### 3.1 人类凭据（human token）

- 文件：`~/.mafw/human.token`（数据根，不是项目）。
- 启动时加载；不存在则生成 **32 字节随机 hex（64 字符）**，原子写（`.tmp` + rename），POSIX `0600`；Windows 仅依赖 ACL/用户目录。
- 请求头：`X-MAFW-Human-Token: <token>`（显式，避免与共享 token 的 `Authorization` 混淆）。
- 比较：长度相等后 `crypto.timingSafeEqual`。
- desktop/TUI 在主进程直接读该文件，经 SDK `clientToken` 选项注入；不回传 renderer、不写日志。
- 文件缺失/不可读 → human-only 动作 fail-closed（403），普通 API 不受影响。

### 3.2 设备凭据（device token）

- 配对码 URL（v2）：`orcalore://pair?url=...&v=2&exp=...&nonce=...`，**不再携带 token**。
- `POST /api/mobile/pairing/verify` body `{ nonce, deviceId?, platform?, deviceName? }`：
  - 消费 nonce（一次性、TTL 5min、rate limit 不变）；
  - 生成 `dev_` + 32 字节 base64url 设备 token；
  - `DeviceStore` 保存 `deviceTokenHash = sha256(token)`、`deviceId`、`platform`、`tokenIssuedAt`，不存明文；
  - 返回 `{ ok:true, token, deviceId }`。
- 认证：`Authorization: Bearer dev_...` 或 `X-MAFW-Device-Token: dev_...` → `principal.kind='human'`、`method='device-token'`、`deviceId`。
- 撤销：`DELETE /api/mobile/devices/:id` / legacy `DELETE /api/devices` 删除条目即撤销；已撤销 token 认证失败。
- DeviceStore 兼容旧记录：缺 `deviceTokenHash` 的记录仍可列出/推送，但不能作为 human 凭据；重新配对后补齐。
- 一个设备重新配对会轮换 device token（旧 token 立即失效）。

### 3.3 认证顺序

对每个 HTTP/WS 请求：

1. `X-MAFW-Human-Token` 匹配 → `human`（method `human-token`）。
2. `X-MAFW-Device-Token` 或 `Authorization: Bearer dev_...` 命中 DeviceStore → `human`（method `device-token`）。
3. `Authorization: Bearer <apiToken>` / `X-API-Token` / `?token=` 匹配共享 token → `service`。
4. loopback 且无凭据 → `local`。
5. 其余 → `anonymous`（非 loopback 直接 401）。

普通 API 授权规则保持现状：`human` / `service` / `local` 放行，`anonymous` 拒绝（remote 无 token 仍 401）。human-only 额外要求 `principal.kind === 'human'`。

### 3.4 请求上下文

- transport 在 auth 后把 principal 挂到 `(req as any).mafwPrincipal`（类型集中在 `core/auth.ts` 的 module augmentation）。
- WS upgrade 同样解析；设备 deviceId 可由 principal 覆盖 query `deviceId`（保留 query 兼容）。
- `registry-dispatch` 的 HMAC/legacy 授权路径不变；它依赖 transport 已完成的认证。

## 4. Human-only 路由

统一 helper：

```ts
// core/auth.ts
export function isHumanPrincipal(p: Principal | undefined): boolean
export function humanOnlyDenied(): { status: 403; body: { error; code: 'human_principal_required' } }
```

改造点（全仓 `human-only` 字符串审计）：

| 路由 | 现状 | E5a |
|---|---|---|
| `POST /api/pods/:podId/goals/:goalId/accept` | `actorSessionID` 存在 → 403 | 非 human principal → 403；actor 存在仍 403 |
| `POST /api/pods/:podId/goals/:goalId/review-items`（create/resolve/reopen） | 同上 | 同上 |
| decision mutation（confirm/reject 等） | `actorOf(body)` → 403 | 非 human principal → 403；actor 仍 403 |
| standing-goal approve run | `actorSessionID` 存在 → 403 | 非 human principal → 403；actor 仍 403 |

- 403 body：`{ error: 'human principal required', code: 'human_principal_required' }`（additive；既有 error 字符串仅在这些路径变化，release 记录）。
- 普通 agent 写路径（goal create、task、memory 等）不要求 human；它们继续用 service/local。
- `actorSessionID` 仍保留为审计字段；human 请求带 actor 也拒绝（防人类 UI 误用 agent 上下文）。

## 5. 客户端接线

### 5.1 SDK

`MafwClientOptions` 增加：
```ts
clientToken?: string          // → X-MAFW-Human-Token
headers?: Record<string, string> // 通用附加头（测试/企业代理）
```
`request()` 合并顺序：默认 Content-Type → `headers` → `clientToken` → 调用点 headers。SSE 不需要 human token（human-only 都是 REST）。

### 5.2 Desktop

- main 进程新增 `readHumanToken()`（`~/.mafw/human.token`，fs 读；失败返回空）。
- `mafw-ipc.ts` / `mafw-sidecar.ts` 所有 `new MafwClient(...)` 传 `{ clientToken }`。
- 不在 renderer 暴露 token；插件 web 的 fetch 不自动带 human token（插件不是 human 动作主体）。

### 5.3 TUI

- `packages/tui/src/ui/app.ts` 创建 `MafwClient` 时读同一文件并传 `clientToken`。
- 读取失败 → 空；human-only 动作显示 gateway 403 错误。

### 5.4 Mobile（Flutter）

- `pairing_link.dart`：
  - 支持 `v=2`（token 可缺省，url/exp/nonce 必填）；
  - 保留 `v=1` 解析（带 token）以兼容旧网关；
  - `PairingLink.token` 改为可空/空串语义。
- `pairing_page.dart`：
  - 生成/持久化稳定 `deviceId`（SharedPreferences 随机 UUID）；
  - `POST /api/mobile/pairing/verify` 带 `{nonce, deviceId, platform, deviceName}`；
  - 用响应里的 `token`（device token）保存 `ConnectionConfig`，而不是链接里的 token；
  - v1/手动回退仍保存链接/手填 token。
- `ConnectionConfig` / `SecureConfigStore` 不变（token 仍是 bearer；内容从共享 token 变成 device token）。
- push registration：`body.token` 继续是 FCM token；设备 ID 用 principal.deviceId（新路径）或旧派生（legacy）。
- 旧手机用共享 token 仍可普通 API；human-only 动作需重新配对拿 device token（release 记录 breaking）。

## 6. 安全与兼容

- **威胁模型**：human token 与 gateway 同 OS 用户，恶意本地进程可读；device token 可撤销。E5a 目标 = agent 误调用/误审批不再被当成人类，不是本机隔离。
- **兼容**：普通 API 的 loopback / 共享 token 行为不变；human-only 由"缺省即人类"改为"必须 human 凭据"（breaking，按安全修复记录）。
- **失败模式**：human token 文件不可读 → human-only 403；DeviceStore 损坏 → 设备 token 全部失效（重新配对）；statfs 无关。
- **日志**：human/device token 一律不落日志；沿用 `redactLog`，新增头名加入脱敏。
- **配置**：不需要新配置键；human token 文件位置固定数据根。可加 `server.humanTokenPath`？不做，保持单源。

## 7. 测试策略

- Gateway 单测：human token 创建/稳定/权限位；principal 解析矩阵（human/device/service/local/anonymous；human 优先；device 撤销；length-mismatch 不抛）；transport 401/principal 挂载；WS upgrade 接受 device/human；human-only 路由 403/200 矩阵；decision/standing-goal 纯函数参数。
- DeviceStore：issue/verify/rotate/revoke；旧记录兼容；hash 不存明文；list 投影不含 hash。
- Pairing：v2 URL 无 token；verify 返回 device token；nonce 复用失败；rate limit 不变。
- SDK：clientToken 头注入；headers 合并；不泄漏到 SSE。
- Desktop/TUI：读取 human token 的 helper（临时目录）；MafwClient 构造参数；类型门禁。
- Mobile Flutter：v2 解析、deviceId 持久化、verify 响应 token 保存、v1 兼容；`flutter test`。
- 集成：真实 transport + 假 human token：human 请求 accept 200，service/local 403；device token 走 pair → verify → human-only 200。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 旧 desktop/TUI 无 human token，human-only 动作全 403 | 同波更新 desktop/TUI；release 明确 breaking；普通 API 不受影响 |
| 旧 mobile v1 共享 token 不能 human-only | 重新配对拿 device token；v1 链接仍可解析但不含 device 凭据 |
| human token 文件被 agent 读取 | 记录威胁模型；后续可做 OS keychain / 进程签名（E6+） |
| human token 首次生成失败导致人审不可用 | fail-closed + 明确 403 code；日志告警；文件系统恢复后重启即可 |
| DeviceStore 轮换导致旧设备掉线 | 重新配对；delete/rotate 作为显式动作；测试覆盖 |
| 路由测试直接调用无 principal | fail-closed 403；测试显式注入 human principal；transport 集成测试覆盖真实路径 |

## 9. 交付边界

- E5a：A2 + A13 + 客户端凭据接线。
- E5b：C1 event_log replay + mobile 游标/幂等。
- E6：desktop 单点扇出/实体缓存、事件→增量补丁、mobile 增量消费。
