# Gateway E11 身份 / 配额硬化（收敛版）：设计（2026-11-13）

> E11 原清单里设备生命周期已完成（deviceName 校验、WS `?deviceId=` 凭据优先、`pruneStale` 定时触发、rotate/revoke 已有）。
> 本波只做**四个真实缺口**：human token 轮换、内部会话配额账实、admission 二次校验、MCP human 边界审计 + keychain 明确 won't do。

## 0. 基线

- catalog：317 ops，44 个有 response schema（E10b 后）。
- human token：`~/.mafw/human.token`，32 字节 hex，POSIX 0600 / Windows 目录 ACL；**无轮换 API**，且 kernel 的 `this.humanToken`（`kernel.ts:796`）在启动时载入后不再变化。
- 内部会话：`SdkSessionResource.registerExternal` 新 id 走 `assertSessionQuota`（`runtime/sdk-session.ts:177-179`）；lead 注册失败只 `log.warn`（`kernel.ts:3998-3999`）或 `.catch(() => {})`（`kernel.ts:7122-7123`），`registerInternalSession` 已先写入 → 账实不符。
- admission：`Scheduler` 只在 `submit` 调 `admissionChecker`（`scheduler.ts:89-96`）；`pump()` 启动队列任务时不再检查（`scheduler.ts:196-209`），降级前入队的非前台任务照常启动。
- MCP：`DEFINITIONS` 无任何 human-only 工具（accept/approve/confirm/shelve/reject/reply/dismiss/merge/undo）；但**没有机器化守卫**，新增工具靠人审。
- keychain / 进程签名：未实现；威胁模型已写明同 OS 用户可读。

## 1. E11-1 Human token 轮换

### Gateway
- `core/human-token.ts` 新增 `rotateHumanToken(dir): string`：生成新 32 字节 hex，复用原子写（`.tmp` + fsync + rename + chmod 0600）。
- 新路由 `routes/human-token.ts`：`POST /api/human-token/rotate`。
  - **只接受 `method === 'human-token'`**（不是任意 human/device principal）：轮换必须证明持有被替换的凭据；device token / service / loopback 一律 403 `human_principal_required`。
  - 成功：`200 { token, rotatedAt }`；新 token 立即生效，旧 token 立刻失效。
  - 失败：写文件失败 → 500 `{ error }`（不改变旧 token）。
- catalog：`humanToken.rotate`（POST，tag `auth`）+ response schema `{ token: string; rotatedAt: string }` → 覆盖 45/318（新 op 同时增加分子与分母；初稿的 45/317 是分母算错）。
- kernel：注入 `rotate` 回调，成功后 `this.humanToken = token`（现有 `() => this.humanToken` getter 立即生效）+ `log.warn('[Auth] human token rotated')`。

### CLI
- `bin/mafw.js`：`mafw rotate-human-token`。读 `~/.mafw/human.token`，带 `X-MAFW-Human-Token` POST 到端点，只打印状态/时间，**不打印新 token**。
- `httpRequest` 增加可选 headers 参数（向后兼容）。

### Desktop
- `mafw-invoke` 统一入口：捕获 SDK 403（错误消息含 `human_principal_required`）→ 用 `createGatewayClient()` 重建 client（重新读文件）→ 原方法**重试一次**；仍失败则抛原错误。
- 纯函数 `isStaleHumanTokenError(err)` 放 `human-token.ts`，单测覆盖 403+code、403 无 code、500 不匹配。
- 不新增 UI；外部轮换后桌面无需重启即可继续 human-only 操作。

### TUI
- 记录为已知限制：轮换后需重启 TUI（无集中重试入口）；不阻塞本波。

## 2. E11-2 内部会话配额账实

- lead 两条注册路径（`kernel.ts:3996-4000`、`kernel.ts:7122-7123`）统一走一个 helper：
  - `registerExternal` 失败（含 `QuotaExceededError`）→ **回滚** `unregisterInternalSession(sessionId)`；
  - 广播 `session.registration_failed`：`{ sessionId, role:'lead', code:'quota_exceeded'|'error', message }`；
  - 保留 `log.warn`；不再有静默 `.catch(() => {})`。
- 不做配额政策变更（内部会话仍占名额），只保证失败可见、无幽灵身份。
- 测试：quota=0 时 lead 注册失败 → internal role/unbind 被回滚、事件发出、无异常泄漏。

## 3. E11-3 Admission 二次校验

- `SchedulerOpts` 新增 `resourceAdmission?: () => boolean`（**只**表达资源压力，不复用 budget checker，避免二次预算语义）。
- `pump()`：对 `priority !== 'foreground'` 的候选任务，`resourceAdmission?.() === false` 时不启动、留在队列（work-conserving：继续尝试其他候选）；前台永不因压力被挡。
- kernel：`resourceAdmission: () => !(this.governor?.isDegraded() ?? false)`；governor `onChange` 在 `degraded` 从非空变空时调用 `void this.scheduler.sweep()`，恢复后自动续跑。
- 测试：降级时排队任务不启动；恢复 + sweep 后启动；前台在降级时仍启动；反复降级/恢复不丢任务。

## 4. E11-4 MCP human 边界 + keychain 决策

- 测试 `gateway/tests/unit/mcp/human-boundary.test.ts`：
  - `DEFINITIONS` 名称快照（新增工具必须显式更新，强制评审）；
  - 名称/描述不得命中 human-only 动词（accept/approve/confirm/shelve/reject/dismiss/merge/undo/rotate），白名单仅 `mafw_pod_review_respond`（Tech Lead 回应）、`mafw_decision_draft`（仅草稿）、`mafw_ask_user`（提问，不代答）；
  - `gateway/src/mcp/**` 源码静态扫描禁止标识符：`confirmDecision`、`shelveDecision`、`acceptGoal`、`replyPermission`、`rotateHumanToken`、`requireHumanPrincipal`。
- 文档：`gateway.md` 明确 **MCP human tools = won't do**（MCP 永远 service principal；human-only 动作只走 human/device 凭据的 HTTP/UI）。
- **OS keychain / 进程签名 = won't do（本阶段）**：同 OS 用户威胁下收益有限，跨平台原生依赖成本高；缓解 = 固定文件 + 0600/ACL + loopback + 轮换 + 审计日志。写入 `gateway.md` 威胁模型段与 release。

## 5. 非目标

- 设备生命周期（已完成）、插件配额政策、强制版本协商、~272 ops schema。
- desktop Config UI 的轮换按钮（CLI + 自动重读已覆盖）。
- TUI 的 403 自动重试。

## 6. 门禁

gateway tsc 0 + 全量（9 env-red）+ `schema:coverage` 45/318 + analyze TOTAL 0。
SDK tsc/full/contract（若 SDK 无改动则只跑回归）。
desktop full（1 resolver env-red）+ tsgo（2 `node:tls`）。
mobile 不涉及；TUI 记录 env-red；kernel-split 7/7。
