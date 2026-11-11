# Gateway E2 恢复闭环 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"重连恢复"从网关单方能力变成端到端协议：greeting 纪元 + 显式 reset（网关）→ SDK/desktop 游标持久化与 `?since`（客户端）→ 重连后按 truncated/reset 分级重同步 → WS 正式降级为 live-only → append 失败可观测。全部 TDD。

**Architecture:** 网关只加 greeting 字段与 reset 判定（不动回放机制）；SDK 与 desktop 各自实现 cursor（SDK 供 TUI，desktop 自带 sse-connection）；WS 只加 headSeq + 文档；EventStore 增失败计数与限频日志。

**Tech Stack:** TypeScript (CJS), Jest（gateway）、node --test（sdk/desktop），无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-gateway-e2-recovery-design.md`

## Global Constraints

- TDD 铁律：每项先红后绿；commit 信息带 `(E2-n)`。
- 不改回放机制本身（event_log/seq/保留策略不动）；不改 SSE 帧结构（只加 greeting 字段）。
- 网关/SDK/desktop 各自 runner；单文件 desktop 测试需 `--conditions=browser`。
- 隔离工作区：`.superpowers/e2-worktree` + 分支 `feat/gateway-e2-recovery`（基 main @ 251968aa；若 main 已前移则以当前 main 为基）。
- 已知环境红名单沿用 E1（claude-adapter ×2、plugin-package-e2e、desktop resolver 需 dist）。

## Review Focus

1. **reset/truncated 分级**：正常回放不得触发全量重同步；只有 reset/instanceId 变化/truncated 才走全量。测试必须钉住"正常路径不 invalidate"。
2. **重连补拉**：desktop 重连后活跃会话消息必须强制刷新（现逻辑桶非空则跳过）——验证"空桶假设"被移除。
3. **游标写入**：SDK/desktop 只从带 `id:` 的帧写 seq；`connected` 与 ping 不写。
4. **重复应用**：同一帧重放（同 seq）不得重复应用——desktop 侧以 seq 单调去重或事件幂等断言。
5. **WS 降级**：connected 加 headSeq 不破坏移动端现有解析（未知字段容忍）。

---

### Task 1: 网关 greeting 纪元 + reset（E2-1）

**Files:** Modify `gateway/src/events/sse-attach.ts`、其 deps 注入点（routes/events-sse.ts / event-hub 或 kernel 接线）；Test `gateway/tests/unit/events/sse-epoch-greeting.test.ts`

**Interfaces:** `attachGlobalSse` deps 增加 `instanceId?: string`、`schemaEpoch?: number`（由接线传 releaseMetadata/runtimeIdentity 现有字段）。Greeting: `{type:'connected', timestamp, vocab:'v2', headSeq, firstReplayedSeq?, truncated?, reset?, instanceId?, schemaEpoch?}`。

- [ ] Step 1: RED — since=0/正常 → 无 reset；since>headSeq → `reset:true` 且不写回放帧；greeting 含 instanceId/schemaEpoch（来自 deps）。
- [ ] Step 2: Run → FAIL（无字段/无 reset 判定）。
- [ ] Step 3: GREEN — 加 deps + 判定（reset 与 truncated 互斥优先）。
- [ ] Step 4: Run PASS + `tests/unit/events/` + `tests/unit/routes/` 绿 + tsc。
- [ ] Step 5: Commit `feat(events): epoch-fence sse greeting with instanceId/schemaEpoch and reset (E2-1)`。

### Task 2: SDK 游标恢复（E2-2）

**Files:** Modify `packages/gateway-sdk/src/sse.ts`；Test `packages/gateway-sdk/src/sse-cursor.test.ts`（或现有 sse 测试文件风格）

**Interfaces:** `subscribe(opts?: { cursor?: { get(): number | null; set(seq: number): void }; onReplayInfo?(info: { headSeq; firstReplayedSeq?; truncated?; reset?; instanceId?; schemaEpoch? }): void })` —— 默认无 cursor 时行为完全不变。

- [ ] Step 1: RED — 带 cursor（get→42）→ URL 含 `since=42`；收到 `id: 7` 帧→ sets 7、无关帧（connected/ping）不写；greeting truncated/reset → onReplayInfo 收到；无 cursor → URL 无 since。
- [ ] Step 2: Run SDK 测试 → FAIL。
- [ ] Step 3: GREEN — 可选游标实现。
- [ ] Step 4: Run PASS + SDK contract 4/4。
- [ ] Step 5: Commit `feat(sdk): resumable sse subscriptions with cursor (E2-2)`。

### Task 3: desktop 游标 + 重连重同步（E2-3）

**Files:** Modify `packages/desktop/src/renderer/mafw/sse/sse-connection.ts`（E1-9 产物）、`MafwShell.tsx`（重连补拉接线）；Test `packages/desktop/tests/sse-cursor.test.ts`

- [ ] Step 1: RED — (a) 持久化 seq（localStorage）→ 重连带 `since`；(b) greeting `truncated:true` 或 `reset:true` 或 instanceId 变化 → 全量重同步路径被调（invalidate + 强制活跃会话消息刷新）；(c) 正常回放 → 不调 invalidate；(d) 活跃会话消息桶非空时重连仍强制刷新（移除"空桶才拉"假设）。
- [ ] Step 2: Run desktop 测试 → FAIL。
- [ ] Step 3: GREEN — sse-connection 加 cursor/greeting 处理；MafwShell onOpen 分支按分级调用。
- [ ] Step 4: Run PASS + `npm run test:desktop` 全绿。
- [ ] Step 5: Commit `feat(desktop): resumable sse with graded resync (E2-3)`。

### Task 4: WS 降级 + headSeq（E2-4）

**Files:** Modify `gateway/src/http/ws-upgrade.ts`（connected 帧）；`docs/architecture/gateway.md`；Test `gateway/tests/unit/http/ws-connected-hearseq.test.ts`

- [ ] Step 1: RED — connected 帧含 `headSeq`（由 deps 提供）；未知字段不影响既有字段。
- [ ] Step 2: Run → FAIL。
- [ ] Step 3: GREEN — 加字段；文档补"WS live-only，重连以 SSE 游标/REST 兜底"。
- [ ] Step 4: Run PASS + `tests/unit/http/` 绿 + tsc。
- [ ] Step 5: Commit `feat(ws): expose headSeq and document live-only semantics (E2-4)`。

### Task 5: append 失败可观测（E2-5）

**Files:** Modify `gateway/src/events/event-store.ts`、`gateway/src/server/event-hub.ts` 或 stats 接线；Test `gateway/tests/unit/events/event-store-append-failure.test.ts`

- [ ] Step 1: RED — append 抛错 → 返回 null、失败计数 +1、限频日志（30s 内一次）；`/api/stats`（或 hub 暴露）反映计数。
- [ ] Step 2: Run → FAIL（静默 null）。
- [ ] Step 3: GREEN — 计数 + 限频 warn/error；stats 接线。
- [ ] Step 4: Run PASS + `tests/unit/events/` 绿。
- [ ] Step 5: Commit `feat(events): observe append failures with rate-limited log and stat (E2-5)`。

### Task 6: 收口（E2-6）

- [ ] Step 1: `docs/architecture/gateway.md` 现状段补 E2；新建 `docs/releases/2026-11-11-gateway-e2-recovery.md`。
- [ ] Step 2: 全量门禁：gateway tsc+全量 jest、SDK 测试+contract、desktop 全量、TUI 全量；记录对比基线。
- [ ] Step 3: 终审（whole-wave review）+ ledger；commit `docs(gateway): E2 closeout (E2-6)`。

## Ledger

`.superpowers/sdd/2026-11-11-gateway-e2-recovery/progress.md`
