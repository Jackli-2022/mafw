# Gateway E5a 身份闭环 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 human-only 动作从"缺省 actorSessionID = 人类"升级为显式 human/device 凭据；移动端从共享 apiToken 升级为可撤销 device token；desktop/TUI 接入 human token。

**Architecture:** `core/auth.ts` 统一 principal 解析（human/device/service/local/anonymous）；human token 固定在 `~/.mafw/human.token`；device token 由 pairing v2 发放、DeviceStore 存 hash；human-only 路由只认 `principal.kind === 'human'`。客户端经 SDK `clientToken` / ConnectionConfig 注入凭据。

**Tech Stack:** TypeScript (CJS), Jest（gateway）、node --test（SDK/desktop/TUI）、Flutter test（mobile）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-12-gateway-e5a-identity-closure-design.md`

## Global Constraints

- TDD 铁律；每项一个 commit `(E5a-n)`。
- 普通 API 的 loopback / 共享 apiToken 行为不变；只有 human-only 判定收紧。
- human-only 403 body：`{ error: 'human principal required', code: 'human_principal_required' }`；既有 actorSessionID 检查继续保留。
- 不把 human/device token 写入日志；`redactLog` 覆盖新头名。
- 隔离工作区 `.superpowers/e5a-worktree` + 分支 `feat/gateway-e5a-identity-closure`（基 main；若 main 前移以此为准）。
- 已知环境红名单沿用（claude-adapter ×2、plugin-package-e2e、desktop resolver 需 gateway/dist）。

## Review Focus

1. **A2 真闭合**：human-only 只认 human/device；service/local 即使不带 actorSessionID 也 403；human + actorSessionID 仍 403。
2. **兼容**：普通 API 的 loopback/共享 token 不变；旧 mobile v1 仍能普通 API；human-only 需重新配对（文档 breaking）。
3. **凭据卫生**：human token 权限位/原子写/常数时间比较；device token 只存 hash、可撤销、轮换旧 token 失效；日志脱敏。
4. **客户端不泄漏**：human token 只在 main 进程读取，不进 renderer/日志/插件 web fetch；SDK 只加显式头。
5. **测试真实路径**：transport 集成测试（真 req/res + principal 挂载）优先于纯 helper；路由测试显式注入 principal。

---

### Task 1: Human token + Principal auth（E5a-1）

**Files:** Create `gateway/src/core/human-token.ts`；Modify `gateway/src/core/auth.ts`、`gateway/src/http/transport.ts`、`gateway/src/http/ws-upgrade.ts`、`gateway/src/kernel.ts`；Test `gateway/tests/unit/core/human-token.test.ts`、`gateway/tests/unit/core/principal.test.ts`、`gateway/tests/unit/http/principal-auth.test.ts`

**Interfaces:** `loadOrCreateHumanToken(dir): string`；`Principal { kind: 'human'|'service'|'local'|'anonymous'; method; deviceId? }`；`resolvePrincipal(req, opts)`；`isHumanPrincipal(p)`；`humanOnlyDenied()`；TransportDeps/WS deps 增加 `humanToken?: () => string`、`verifyDeviceToken?: (token) => { deviceId: string } | null`。

- [ ] Step 1: RED — human token 创建/稳定/0600/原子写；principal 解析矩阵（human 优先、device、service、local、anonymous；长度不等不抛）；transport：无 token remote 401、loopback local 放行、human/service 放行、`req.mafwPrincipal` 挂载正确；WS upgrade 接受 human/device、拒绝 anonymous。
- [ ] Step 2: GREEN — 实现 human-token/auth；transport/WS 接入；kernel 加载 human token（启动时，失败 log.warn + 空串 fail-closed）；`httpTransportDeps`/`createWsHub` 传 live getter + device verifier（device verifier 可先返回 null，Task 3 补）。
- [ ] Step 3: 跑 tsc + 新测试 + `tests/unit/http/ tests/unit/core/`；确认既有 auth 测试更新后仍绿。
- [ ] Step 4: Commit `feat(auth): human token and principal resolution (E5a-1)`。

### Task 2: Human-only route guards（E5a-2）

**Files:** Modify `gateway/src/routes/pods.ts`、`gateway/src/routes/decisions.ts`、`gateway/src/routes/standing-goals.ts`（以及全仓 `human-only` 审计命中的其他路由）；Test `gateway/tests/unit/routes/human-only-guards.test.ts` + 现有 pod/decision/standing-goal 测试更新

**Interfaces:** `isHumanPrincipal((req as any).mafwPrincipal)`；`humanOnlyDenied()`；`handleDecisionMutation` 增加 `human: boolean` 参数（或等价）。

- [ ] Step 1: RED — pod accept / review-items create+resolve+reopen / decision mutation / standing-goal approve：无 principal、service、local → 403 `code:'human_principal_required'`；human → 200；human + actorSessionID → 403；普通 goal create/task/memory 不受影响。
- [ ] Step 2: GREEN — 用 principal helper 替换/前置现状 actor 检查；保留 actor 检查；路由测试显式注入 human principal；transport 集成测试覆盖真实头。
- [ ] Step 3: 跑 tsc + `tests/unit/routes/ tests/unit/pod/ tests/unit/core/`；全仓 grep 确认无遗漏 human-only 分支。
- [ ] Step 4: Commit `fix(auth): require human principal for human-only routes (E5a-2)`。

### Task 3: Device credentials + pairing v2（E5a-3）

**Files:** Modify `gateway/src/mobile/device-store.ts`、`gateway/src/mobile/push-gateway.ts`、`gateway/src/mobile/pairing.ts`、`gateway/src/routes/devices-mobile.ts`、`gateway/src/kernel.ts`（device verifier wiring）；Test `gateway/tests/unit/mobile/device-store-credentials.test.ts`、`pairing-v2.test.ts`、`tests/unit/routes/devices-credentials.test.ts`

**Interfaces:** `DeviceEntry.deviceTokenHash?/tokenIssuedAt?`；`DeviceStore.issueCredential/verifyCredential/revokeCredential`；`PushGateway.issueDeviceToken/verifyDeviceToken`；`PairingService.generatePairingCode` v2 无 token；`pairingVerify` 返回 `{ok, token, deviceId}`。

- [ ] Step 1: RED — v2 URL 不含 token；verify 发 `dev_` token、存 hash、不存明文；verify 同 token 可用于 auth/human-only；轮换后旧 token 失败；delete 撤销；旧记录兼容；list 不返回 hash；pairing nonce 复用/过期仍失败。
- [ ] Step 2: GREEN — DeviceStore/PushGateway/PairingService/routes 改造；`mobile.devicesRegister` 优先用 principal.deviceId（legacy 保留）；transport device verifier 接 PushGateway；`devices` list 投影脱敏。
- [ ] Step 3: 跑 tsc + `tests/unit/mobile/ tests/unit/routes/devices* tests/unit/http/principal-auth.test.ts`；确认普通 API/推送回归。
- [ ] Step 4: Commit `feat(mobile): per-device credentials and pairing v2 (E5a-3)`。

### Task 4: SDK/desktop/TUI client token（E5a-4）

**Files:** Modify `packages/gateway-sdk/src/types.ts`、`packages/gateway-sdk/src/client.ts` + tests；Create `packages/desktop/src/main/human-token.ts`；Modify `packages/desktop/src/main/mafw-ipc.ts`、`packages/desktop/src/main/mafw-sidecar.ts` + tests；Modify `packages/tui/src/ui/app.ts` + helper/test

**Interfaces:** `MafwClientOptions.clientToken?: string`、`headers?: Record<string,string>`；SDK request 合并 `X-MAFW-Human-Token`；desktop/TUI `readHumanToken()`（数据根；失败空）。

- [ ] Step 1: RED — SDK clientToken 注入到每个 request，headers 合并顺序正确，SSE 不带；desktop/TUI helper 读临时 human.token；构造参数含 token。
- [ ] Step 2: GREEN — 实现 SDK/desktop/TUI；所有 `new MafwClient` 传 token；renderer 不接触 token。
- [ ] Step 3: 跑 SDK tsc + full + contract；desktop `npm test` + tsgo（允许既有 node:tls 噪声）；TUI `npm run test:tui`。
- [ ] Step 4: Commit `feat(clients): send human token from desktop and TUI (E5a-4)`。

### Task 5: Mobile pairing v2 + device token（E5a-5）

**Files:** Modify `mobile/lib/src/config/pairing_link.dart`、`mobile/lib/src/pages/pairing_page.dart`、必要时 `secure_config_store.dart`/新增 `device_id.dart`；Test `mobile/test/pairing_link_test.dart`、`pairing_page_test.dart`、`secure_config_test.dart`

**Interfaces:** `PairingLink.token` 可空；v2 解析；`pairing_page` 持久化 deviceId、verify 后用返回 token 保存。

- [ ] Step 1: RED — v2 link 无 token 仍可解析；v1 仍可解析；过期/缺字段失败；pairing page 用 verify 返回 token（测试 fake HTTP）；deviceId 稳定持久。
- [ ] Step 2: GREEN — 实现 Dart 解析/页面/存储；旧 v1 手动回退保留。
- [ ] Step 3: `flutter test` 目标文件 + 全量（记录环境）；`dart analyze` 若可用。
- [ ] Step 4: Commit `feat(mobile): pairing v2 and device token storage (E5a-5)`。

### Task 6: 收口（E5a-6）

- [ ] Step 1: `docs/architecture/gateway.md` E5a 段（principal 矩阵、human/device token、human-only 路由、配对 v2、威胁模型/兼容 breaking）；`docs/releases/2026-11-12-gateway-e5a-identity.md`（基 commit、任务 commits、breaking、测试证据、Deferred）。
- [ ] Step 2: 全量门禁（gateway tsc + full jest 允许 env-red；SDK full+contract；desktop；TUI；mobile `flutter test`；analyzer 0；kernel-split）。
- [ ] Step 3: 终审 + fix round + ledger；commit `docs(gateway): E5a identity closeout (E5a-6)`。

## Ledger

`.superpowers/sdd/2026-11-12-gateway-e5a-identity/progress.md`
