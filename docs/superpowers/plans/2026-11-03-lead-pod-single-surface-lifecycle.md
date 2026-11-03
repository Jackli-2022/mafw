# Lead 单一展示面与 Session 生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一个项目只有一个当前 Lead、一个 Pod，Lead 只从鲸群进入，并把 Lead/Goal 内部 session 的恢复、归档、隐藏与 revision 退休收敛到可测试的生命周期服务。

**Architecture:** gateway 新增 Lead 解析纯函数、`LeadSessionRegistry` 与 `PodSessionLifecycle`，把 kv、Pod coordination、runtime 活性收敛成一个可重入流程；新增显式 `POST /api/pods/:podId/lead/ensure`，所有 GET/轮询保持只读。desktop 删除工作 rail 的 `ManagerCard`，改由 Pod detail 的 active coordination 作为唯一 Lead UI 权威，鲸群负责 Lead 入口、Welcome 负责导航。历史 Manager 会话只作为普通历史可读，不参与当前 Lead 解析。

**Tech Stack:** TypeScript, Node HTTP, better-sqlite3, Jest, SolidJS, Electron, `@mafw/sdk`, node --test + test-shim, `mafw`/Electron.

**Spec:** `docs/superpowers/specs/2026-11-03-lead-pod-single-surface-lifecycle-design.md`

## Global Constraints

- 一个项目只有一个逻辑 Lead；同一时刻只有 active runtime 的 slot 或 active Pod coordination 参与当前解析。
- 历史 `role:manager` / `manager-archived` 永远不能作为当前 Lead fallback。
- `GET /api/manager/session`、Pod lookup、UI 轮询保持只读；只有显式 `POST /api/pods/:podId/lead/ensure`、启动 recovery、Pod ensure 可以创建/替换 Lead。
- desktop 的 Lead id 唯一 UI 权威是当前 Pod detail 的 active `node='coordination'` session。
- `manager-session` kv、`manager.rotate` HTTP/SDK 名称保留为内部兼容面；用户界面不出现 Manager。
- 旧 Lead 替换前 best-effort snapshot；旧 session 降为 `lead-archived` 并保持可读。
- Builder / Reviewer / Probe 都是内部 session；旧 Tech Lead revision lease 必须可退休。
- 本计划不修改 `startGoalDirect` 的 Pod queue/pause/budget 绕过；该问题另批处理。
- 历史 revision 文件、state 快照、waves/eval/review 证据 append-only，不重写、不反归档。
- 每个任务必须 TDD、独立 commit，并报告新增测试数与 focused/full 通过数。
- 执行子代理统一使用 `gateway/volcengine/deepseek-v4.1-flash`。

## Review Focus

- **`byRuntime` 槽位被旧 reader 当 v1 解构**：现行 Lead 的 Goal snapshot 会静默消失；Task 3 必须用 registry 反查并钉测试。
- **kv 缺失/死亡但 Pod coordination 活着**：错误实现会再建一个 Lead；Task 2/4 必须覆盖“接管而非新建”。
- **Lead 从鲸群打开后没有 Lead metadata**：会出现 `Chat N`、agent 解锁、invite 丢失；Task 10 必须覆盖已有 tab 的 metadata 升级。
- **旧 revision 的 active Tech Lead lease 抢走“最新会话”入口**：Pod 会打开旧讨论；Task 7 必须覆盖 stale sweep。
- **内部 worker 或历史 Manager 从普通会话列表复活**：Task 6/9 必须同时测试隐藏角色、确定性 agent 与历史 Manager 不冒充 Lead。

---

### Task 1: Lead 解析纯规则

**Files:**
- Create: `gateway/src/core/manager/lead-session-resolution.ts`
- Test: `gateway/tests/unit/lead-session-resolution.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `type LeadCandidateSource = 'slot' | 'pod'`
  - `interface LeadCandidate { sessionId: string; source: LeadCandidateSource }`
  - `type LeadResolution = { action: 'reuse'; sessionId: string; source: LeadCandidateSource } | { action: 'create' } | { action: 'conflict'; reason: 'ambiguous_slot_keys' }`
  - `resolveLeadCandidate(input: { slot: LeadCandidate | null; pod: LeadCandidate | null; slotKeyConflict?: boolean }): LeadResolution`
  - `shouldEnsureLeadOnStartup(input: { hasPod: boolean; hasInFlightGoal: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { resolveLeadCandidate, shouldEnsureLeadOnStartup } from '../../src/core/manager/lead-session-resolution';

describe('resolveLeadCandidate', () => {
  test('live slot wins over live pod', () => {
    expect(resolveLeadCandidate({
      slot: { sessionId: 'ses_slot', source: 'slot' },
      pod: { sessionId: 'ses_pod', source: 'pod' },
    })).toEqual({ action: 'reuse', sessionId: 'ses_slot', source: 'slot' });
  });

  test('missing slot adopts live pod instead of creating', () => {
    expect(resolveLeadCandidate({
      slot: null,
      pod: { sessionId: 'ses_pod', source: 'pod' },
    })).toEqual({ action: 'reuse', sessionId: 'ses_pod', source: 'pod' });
  });

  test('ambiguous slot keys without live pod refuses to create a second Lead', () => {
    expect(resolveLeadCandidate({ slot: null, pod: null, slotKeyConflict: true }))
      .toEqual({ action: 'conflict', reason: 'ambiguous_slot_keys' });
  });

  test('both absent creates exactly one replacement', () => {
    expect(resolveLeadCandidate({ slot: null, pod: null })).toEqual({ action: 'create' });
  });

  test('startup only ensures Pod projects or in-flight goals', () => {
    expect(shouldEnsureLeadOnStartup({ hasPod: true, hasInFlightGoal: false })).toBe(true);
    expect(shouldEnsureLeadOnStartup({ hasPod: false, hasInFlightGoal: true })).toBe(true);
    expect(shouldEnsureLeadOnStartup({ hasPod: false, hasInFlightGoal: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/lead-session-resolution.test.ts --runInBand --forceExit`  
Expected: FAIL because module/functions do not exist.

- [ ] **Step 3: Implement the pure functions**

Priority is exactly: live slot → live pod → conflict → create. `shouldEnsureLeadOnStartup` returns `hasPod || hasInFlightGoal`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/lead-session-resolution.test.ts --runInBand --forceExit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/manager/lead-session-resolution.ts gateway/tests/unit/lead-session-resolution.test.ts
git commit -m "feat(lead): add deterministic session resolution rules"
```

---

### Task 2: LeadSessionRegistry

**Files:**
- Create: `gateway/src/core/manager/lead-session-registry.ts`
- Test: `gateway/tests/unit/lead-session-registry.test.ts`
- Use: `gateway/src/core/manager/manager-session-runtime.ts`（`readManagerSlot/writeManagerSlot`）
- Use: `gateway/src/core/pod/pod-identity.ts`（`canonicalProjectDir`）

**Interfaces:**
- Consumes: Task 1 的 `resolveLeadCandidate`。
- Produces:

```ts
export interface LeadSessionRecord {
  sessionId: string;
  createdAt: string | null;
  source: 'slot' | 'pod' | 'created';
}

export interface LeadSessionRegistryDeps {
  kvGet(scope: string, key: string): unknown;
  kvSet(scope: string, key: string, value: unknown): void;
  kvAll<T = unknown>(scope: string): Array<{ key: string; value: T }>;
  runtimeName: string;
  podByProject(projectDir: string): { podId: string; projectDir: string } | null;
  activePodCoordination(podId: string): { sessionId: string } | null;
  createSession(projectDir: string): Promise<string>;
  isAlive(sessionId: string): Promise<boolean>;
  registerLead(sessionId: string, projectDir: string): Promise<void>;
  archiveLead(sessionId: string, projectDir: string): Promise<void>;
  bindPodLead(podId: string, sessionId: string): Promise<void>;
  now(): string;
  log?(message: string): void;
}

export class LeadSessionConflictError extends Error {}
export class LeadSessionRegistry {
  current(projectDir: string): LeadSessionRecord | null;
  findBySessionId(sessionID: string): { projectDir: string; sessionId: string } | null;
  ensure(projectDir: string): Promise<LeadSessionRecord>;
}
```

**Semantics:**
- `current` reads only active-runtime slot, canonicalizes project lookup, never probes/creates.
- `ensure` probes slot and Pod coordination; uses Task 1 result.
- Pod adoption writes the active-runtime slot and calls `bindPodLead`.
- Replacement archives the old slot session after slot/Pod divergence or dead slot.
- Multiple canonical-equivalent raw keys with live slots and no Pod live => `LeadSessionConflictError`, zero creates.
- Other runtime slots are preserved verbatim.
- `findBySessionId` scans active-runtime slots only and returns canonical project key.

- [ ] **Step 1: Write failing tests**

Use a temp DB + real `PodStore` for Pod rows and a fake kv map/runtime. Required cases:

```ts
test('reads byRuntime slot instead of assuming v1 value', ...)
test('adopts active Pod coordination when kv is missing', ...)
test('writes adopted Pod id into active runtime slot', ...)
test('does not adopt a dormant non-active runtime slot', ...)
test('reuses Pod when kv points to a dead session', ...)
test('creates one replacement when both kv and Pod are dead', ...)
test('archives the dead/diverged old Lead exactly once', ...)
test('multiple canonical-equivalent live keys without Pod conflict and create nothing', ...)
test('findBySessionId only matches active runtime slots', ...)
test('ensure is idempotent when called twice', ...)
```

For the conflict case assert `createSession` call count is `0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/lead-session-registry.test.ts --runInBand --forceExit`  
Expected: FAIL module missing.

- [ ] **Step 3: Implement `LeadSessionRegistry`**

Canonical-key strategy:
- Build candidates from `kvAll('manager-session')`, grouping by `canonicalProjectDir`.
- Prefer exact canonical key; if no exact and exactly one live active-runtime candidate, adopt it.
- More than one live candidate without exact/Pod winner => conflict.
- Write only canonical key; never delete old rows.
- Worktree-keyed rows stay dormant.

- [ ] **Step 4: Run focused test**

Run: `cd gateway; npx jest tests/unit/lead-session-registry.test.ts --runInBand --forceExit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/manager/lead-session-registry.ts gateway/tests/unit/lead-session-registry.test.ts
git commit -m "feat(lead): add recoverable project lead registry"
```

---

### Task 3: Gateway lifecycle integration + Goal snapshot fix

**Files:**
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/core/pod/pod-service.ts`（只接 `ensure` 调用，不改规则）
- Test: `gateway/tests/unit/lead-session-wiring.test.ts`
- Test: `gateway/tests/unit/lead-session-registry.test.ts`（补 findBySessionId）

**Interfaces:**
- Consumes: `LeadSessionRegistry.current/ensure/findBySessionId`。
- Produces:
  - `private leadSessionRegistry!: LeadSessionRegistry`
  - `private ensureManagerSession(projectDir, mafwDir)` 保持返回 `Promise<string>`，内部委托 registry。
  - 启动 ensure 条件使用 `shouldEnsureLeadOnStartup`。

- [ ] **Step 1: Write failing wiring/behavior tests**

Add assertions that:
- Recall/session snapshot path uses `leadSessionRegistry.findBySessionId` and does not contain `.value.sessionId` lookup.
- Startup project set includes only Pod projects and project dirs derived from non-terminal goal states.
- `createManagerSession` delegates to `leadSessionRegistry.ensure` and contains no direct `runtime.session.create` or raw `kvSet('manager-session'` write.
- `GET /api/manager/session?projectDir=` still returns the same DTO `{projectDir,sessionId,createdAt}` for a byRuntime slot.

The wiring test reads source with `readFileSync`, following existing wiring-test style; the DTO behavior is covered by the existing manager-session route tests plus a byRuntime fixture.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/lead-session-wiring.test.ts tests/unit/lead-session-registry.test.ts --runInBand --forceExit`  
Expected: FAIL on old direct kv/runtime paths.

- [ ] **Step 3: Wire the registry into `index.ts`**

Required wiring:
- Construct `LeadSessionRegistry` after `PodStore` and before `PodService`.
- `createSession` callback creates runtime session in the registered project’s canonical dir and returns id.
- `registerLead` calls `sdkSession.registerExternal(..., projectLeadSessionMetadata())` and `registerInternalSession(sessionId, 'lead', resolveIdentityAlias('manager'))`.
- `isAlive` calls runtime `session.get`, returns false only for explicit missing.
- `bindPodLead` calls `PodService.bindLead` lazily.
- `archiveLead`是 Task 4 提供的 callback；本任务可先用 no-op 注入并在 Task 4 替换为真实实现。
- Replace `createManagerSession` body with `leadSessionRegistry.ensure(...)`.
- Replace `readManagerSessionEntry` with `leadSessionRegistry.current(...)`.
- Replace Goal snapshot `kvAll(...).find(e => e.value.sessionId === sessionID)` with `leadSessionRegistry.findBySessionId(sessionID)` and use returned canonical project dir。
- `GET /api/manager/session?projectDir=` must resolve through `leadSessionRegistry.current(filter)` (canonical), not exact raw `kvAll` key matching; list-all still emits one active-runtime DTO per project.
- Replace startup loop with:
  - set of canonical dirs from existing Pods;
  - plus canonical `projectDir` from non-terminal entries in `this.activeGoals`;
  - call ensure only for that set.
- Keep `PodService.ensure` path calling the same ensure.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/lead-session-wiring.test.ts tests/unit/lead-session-registry.test.ts tests/unit/manager-session-runtime.test.ts tests/unit/manager-rotate.test.ts --runInBand --forceExit`  
Expected: PASS.

- [ ] **Step 5: Run gateway typecheck**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`  
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/index.ts gateway/src/core/pod/pod-service.ts gateway/tests/unit/lead-session-wiring.test.ts gateway/tests/unit/lead-session-registry.test.ts
git commit -m "feat(lead): route gateway lifecycle through lead registry"
```

---

### Task 4: Replace/archive old Lead with evidence retained

**Files:**
- Modify: `gateway/src/core/pod/pod-service.ts`
- Modify: `gateway/src/core/session-visibility.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-service.test.ts`
- Test: `gateway/tests/unit/core/session-visibility.test.ts`
- Test: `gateway/tests/unit/lead-session-registry.test.ts`

**Interfaces:**
- Consumes: Task 2 registry `archiveLead` callback; `PodService.snapshotSession(sessionId)`。
- Produces:
  - `PodServiceDeps.archiveLeadSession?(sessionId: string): Promise<void> | void`
  - `PodService.bindLead(podId, managerSessionId)` replacement path snapshots + archives every different active coordination row before ending it.
  - `lead-archived` is a visible role and never hidden/lead-resolved.

- [ ] **Step 1: Write failing tests**

```ts
test('bindLead snapshots and archives the replaced coordination session', ...)
test('bindLead still ends/archives when transcript snapshot fails', ...)
test('lead-archived sessions stay visible but lead/manager metadata does not resolve as current', ...)
test('registry archives dead kv lead even when no Pod row exists', ...)
```

Assert:
- old coordination row `endedAt` set;
- snapshot callback called before end for live replacement;
- archive callback called exactly once;
- new coordination is the only active row;
- `isHiddenSession({ metadata: { mafw: { role: 'lead-archived' } } }) === false`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/pod/pod-service.test.ts tests/unit/core/session-visibility.test.ts tests/unit/lead-session-registry.test.ts --runInBand --forceExit`  
Expected: FAIL.

- [ ] **Step 3: Implement archive behavior**

- Add optional `archiveLeadSession` to `PodServiceDeps`; call it after best-effort snapshot and before/after ending the old row (must never skip archive due snapshot failure).
- In `index.ts`, implement real callback:
  - `sdkSession.updateMetadata(sessionId, { mafw: { role: 'lead-archived' } })`
  - remove `internal-session` kv/map binding (`unregisterInternalSession`)
  - `identityState.unbind(sessionId)`
- Add `unregisterInternalSession` helper next to `registerInternalSession`.
- No bulk rewrite of existing `manager-archived` rows.
- Update visibility comments/tests; do not add `lead-archived` to hidden lists.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-service.test.ts tests/unit/core/session-visibility.test.ts tests/unit/lead-session-registry.test.ts --runInBand --forceExit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-service.ts gateway/src/core/session-visibility.ts gateway/src/index.ts gateway/tests/unit/pod/pod-service.test.ts gateway/tests/unit/core/session-visibility.test.ts gateway/tests/unit/lead-session-registry.test.ts
git commit -m "feat(lead): retain replaced lead evidence as archived history"
```

---

### Task 5: Explicit Lead ensure endpoint + SDK/preload

**Files:**
- Modify: `gateway/src/core/pod/pod-service.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/contract/openapi.json`（通过 `npm run emit:openapi` 生成）
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Test: `gateway/tests/unit/routes/pod-lead-ensure.test.ts`
- Test: `packages/gateway-sdk/src/client.test.ts`
- Test: `packages/desktop/tests/pod-preload-wiring.test.ts`

**Interfaces:**
- Consumes: Task 3 single lifecycle。
- Produces:
  - `interface PodLeadEnsureResult { podId: string; projectDir: string; sessionId: string }`
  - `PodService.ensureLead(podId: string): Promise<PodLeadEnsureResult>`
  - `POST /api/pods/:podId/lead/ensure`
  - SDK `pod.ensureLead(podID: string): Promise<PodLeadEnsureResult>`
  - preload `pod.ensureLead(podID)`

- [ ] **Step 1: Write failing tests**

Route test:
- method POST + existing pod → calls `pods.ensureLead` once, returns 200 DTO;
- unknown pod → 404;
- GET → route not handled (现有 404 行为)，且 `ensureLead` 调用次数为 0；
- no body/actor required for local single-user access.

SDK test:

```ts
test("pod.ensureLead sends POST /api/pods/:podId/lead/ensure", async () => {
  await c.pod.ensureLead("pod 1")
  expect(url).toBe("/api/pods/pod%201/lead/ensure")
  expect(method).toBe("POST")
})
```

Preload wiring asserts `ensureLead: (podID) => invoke("pod", "ensureLead", podID)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/routes/pod-lead-ensure.test.ts --runInBand --forceExit`  
Run: `cd packages/gateway-sdk; npm test`  
Expected: FAIL missing method/route.

- [ ] **Step 3: Implement endpoint and client surface**

- `PodService.ensureLead` gets pod, calls `getManagerSession(pod.projectDir)`, calls `bindLead`, returns `{podId,projectDir,sessionId}`.
- `handlePods` match `/api/pods/:podId/lead/ensure` before generic pod routes.
- Register `{ method: 'POST', path: '/api/pods/:podId/lead/ensure', operationId: 'pods.lead.ensure', tags: ['pod'] }`.
- Add SDK type/method, preload method.
- Run `cd gateway; npm run emit:openapi`; do not hand-edit generated artifacts.

- [ ] **Step 4: Run focused tests + contract**

Run: `cd gateway; npx jest tests/unit/routes/pod-lead-ensure.test.ts tests/unit/api-contract.test.ts --runInBand --forceExit`  
Run: `cd packages/gateway-sdk; npm test`  
Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-preload-wiring.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-service.ts gateway/src/routes/pods.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/routes/pod-lead-ensure.test.ts packages/gateway-sdk packages/desktop/src/preload/mafw-api.ts packages/desktop/tests/pod-preload-wiring.test.ts
git commit -m "feat(pod): add explicit lead ensure endpoint"
```

---

### Task 6: Normalize Lead roster and hide Pod worker sessions

**Files:**
- Modify: `gateway/src/core/pod/pod-identity.ts`
- Modify: `gateway/src/core/pod/pod-service.ts`
- Modify: `gateway/src/core/session-visibility.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-service.test.ts`
- Test: `gateway/tests/unit/core/session-visibility.test.ts`
- Test: `gateway/tests/unit/pod/pod-identity.test.ts`（无则创建）

**Interfaces:**
- Produces:
  - `podInternalSessionRoleForNode(node: 'plan' | 'probe' | 'execute' | 'review'): 'tech_lead' | 'probe' | 'builder' | 'reviewer'`
  - `PodService.ensureMembers` idempotently upgrades existing Lead `agentName:'manager'` to `'lead'`, preserving id/pod.
  - `INTERNAL_SESSION_ROLES` includes `builder`, `reviewer`, `probe`.
  - `INTERNAL_SESSION_AGENTS` includes `mafw-execute`, `mafw-review`.

- [ ] **Step 1: Write failing tests**

```ts
test('legacy lead roster manager agentName is normalized without changing member id', ...)
test('mapping covers plan/probe/execute/review', ...)
test('builder/reviewer/probe roles are hidden', ...)
test('mafw-execute/mafw-review agents are hidden even after internal kv expiry', ...)
test('lead-archived and manager-archived remain visible', ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/pod/pod-service.test.ts tests/unit/pod/pod-identity.test.ts tests/unit/core/session-visibility.test.ts --runInBand --forceExit`  
Expected: FAIL.

- [ ] **Step 3: Implement normalization and hidden vocabulary**

- In `ensureMembers`, when existing `role==='lead'` and `agentName==='manager'`, upsert same row with `agentName:'lead'`.
- In `onSessionCreated`, for non-plan phases call `registerInternalSession(sessionId, podInternalSessionRoleForNode(phase))`.
- Do not override the Tech Lead discussion registration for plan sessions.
- Add the roles/agents above to visibility sets.
- Keep Pod detail/session transcript endpoints unfiltered.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-service.test.ts tests/unit/pod/pod-identity.test.ts tests/unit/core/session-visibility.test.ts tests/unit/session-list-selection.test.ts --runInBand --forceExit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-identity.ts gateway/src/core/pod/pod-service.ts gateway/src/core/session-visibility.ts gateway/src/index.ts gateway/tests/unit/pod/pod-service.test.ts gateway/tests/unit/pod/pod-identity.test.ts gateway/tests/unit/core/session-visibility.test.ts
git commit -m "feat(pod): normalize lead roster and hide worker sessions"
```

---

### Task 7: Revision lease retirement + stale sweep

**Files:**
- Create: `gateway/src/core/pod/pod-session-lifecycle.ts`
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/core/pod/pod-goal-revision-service.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-session-lifecycle.test.ts`
- Test: `gateway/tests/unit/pod/pod-result-reject.test.ts`
- Test: `gateway/tests/unit/pod/pod-goal-revision-service.test.ts`

**Interfaces:**
- Consumes: `PodSessionSupervisor`, `PodStore`, `PodService.snapshotSession`。
- Produces:

```ts
export interface PodSessionLifecycleDeps {
  store: PodStore;
  supervisor: Pick<PodSessionSupervisor, 'retire'>;
  snapshotSession(sessionId: string): Promise<unknown>;
  log?(message: string): void;
}
export class PodSessionLifecycle {
  retireRevision(goalId: string, revision: number): Promise<boolean>;
  retireStaleDiscussionLeases(): Promise<number>;
}
```

- `PodStore.listActiveScopedSessions(): PodSessionRow[]` returns all `scope_kind IS NOT NULL AND ended_at IS NULL`.
- `PodGoalRevisionServiceDeps.onRevisionClosed?(goalId, revision): Promise<void> | void`；`openNextRevision` awaits it after `closeCurrentRevision` and before creating N+1.
- `PodGoalServiceDeps.sessions?: Pick<PodSessionLifecycle, 'retireRevision'>`；`notifyResult` awaits retirement after the applied finish.
- index constructs lifecycle after supervisor and calls `retireStaleDiscussionLeases()` once after Goal recovery/reconcile and before restoring worker state.

**Sweep rule:** retire when goal/revision row is missing, `revision !== root.activeRevision`, or revision status is terminal (`completed/aborted/discarded`). Keep current active non-terminal revision lease.

- [ ] **Step 1: Write failing tests**

Lifecycle:
```ts
test('retireRevision snapshots and ends only the target revision lease', ...)
test('snapshot failure still retires the lease', ...)
test('stale sweep retires old and terminal revisions but keeps current active', ...)
test('missing goal/revision lease is retired', ...)
```

Integration:
- `notifyResult` retires revision 1 after completing it.
- `openNextRevision` awaits revision-1 retirement before revision-2 session creation hook.
- old revision artifacts/state snapshots remain byte-identical.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/pod/pod-session-lifecycle.test.ts tests/unit/pod/pod-result-reject.test.ts tests/unit/pod/pod-goal-revision-service.test.ts --runInBand --forceExit`  
Expected: FAIL.

- [ ] **Step 3: Implement lifecycle and hooks**

- Snapshot first; if snapshot throws, call supervisor.retire and log warning.
- `retireRevision` resolves Lead member by role `tech_lead`, scope `{podId,memberId,goalId,revision,kind:'discussion'}`.
- `retireStaleDiscussionLeases` iterates active scoped discussion rows and applies sweep rule.
- Add lazy callback wiring to avoid construction-order cycles.
- Do not physically delete runtime sessions or artifacts.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-session-lifecycle.test.ts tests/unit/pod/pod-result-reject.test.ts tests/unit/pod/pod-goal-revision-service.test.ts tests/unit/pod/pod-session-supervisor.test.ts --runInBand --forceExit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-session-lifecycle.ts gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/core/pod/pod-goal-revision-service.ts gateway/src/index.ts gateway/tests/unit/pod/pod-session-lifecycle.test.ts gateway/tests/unit/pod/pod-result-reject.test.ts gateway/tests/unit/pod/pod-goal-revision-service.test.ts
git commit -m "feat(pod): retire stale tech lead revision leases"
```

---

### Task 8: Remove fixed Lead row from work rail

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/ManagerCard.tsx`
- Delete: `packages/desktop/tests/manager-row-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/session-tree.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/session-tree.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/components/rail-display.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/rail-display.test.ts`
- Modify: `packages/desktop/tests/lead-entry-wiring.test.ts`
- Modify: `packages/desktop/tests/lead-coordinator-wiring.test.ts`
- Modify: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: 无新增。
- Produces:
  - `SessionNode`/`ProjectNode` no longer expose `manager` special row.
  - 工作 rail 的 `sessions` face 只走普通时间分组。
  - Lead tab 的打开/恢复能力仍由 shell 保留（Task 9/10 接管）。

- [ ] **Step 1: Update tests first**

- Replace `manager-row-wiring.test.ts` with assertions in `lead-entry-wiring.test.ts`:
  - `LeftDock` does not import/render `ManagerCard`;
  - `mafw.css` has no `.mafw-manager-row`;
  - `session-tree` has no `isLeadSessionRole` extraction and returns no `manager` field.
- `session-tree.test.ts`: legacy manager sessions appear inside normal date groups, not a special node.
- `design-contract.test.ts`: remove `.mafw-manager-row:hover` requirement.
- `rail-display.test.ts`: remove `managerPhaseLabel` test and export.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test tests/lead-entry-wiring.test.ts tests/lead-coordinator-wiring.test.ts tests/design-contract.test.ts src/renderer/mafw/components/session-tree.test.ts src/renderer/mafw/components/rail-display.test.ts`  
Expected: FAIL on old fixed row.

- [ ] **Step 3: Remove card and special tree behavior**

- Delete `ManagerCard.tsx` and its import/props/`managerRow` block in LeftDock.
- Remove `managerSessionId` prop from LeftDock and remove MafwShell’s attribute; keep `leadIdFor` for now until Task 10.
- Remove `.mafw-manager-row*` CSS.
- Remove `managerPhaseLabel` and `PHASE_LABELS`.
- Change `SessionNode`/`ProjectNode` so no session is extracted as `manager`; every visible session goes to `groups`.
- Keep `isLeadSessionRole` usage elsewhere until Task 9; this task only removes the UI row.

- [ ] **Step 4: Run focused tests**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test tests/lead-entry-wiring.test.ts tests/lead-coordinator-wiring.test.ts tests/design-contract.test.ts src/renderer/mafw/components/session-tree.test.ts src/renderer/mafw/components/rail-display.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests packages/desktop/src/renderer/mafw/components/session-tree.test.ts packages/desktop/src/renderer/mafw/components/rail-display.test.ts
git commit -m "refactor(desktop): remove fixed lead row from work rail"
```

---

### Task 9: Desktop Lead identity module, no Manager fallback

**Files:**
- Create: `packages/desktop/src/renderer/mafw/lead-session.ts`
- Create: `packages/desktop/src/renderer/mafw/lead-session.test.ts`
- Delete: `packages/desktop/src/renderer/mafw/manager-session.ts`
- Delete: `packages/desktop/src/renderer/mafw/manager-session.test.ts`
- Modify: `MafwShell.tsx`, `ChatPane.tsx`, `WelcomeHome.tsx`, `AgentPicker.tsx`, `session-workspace.ts`, `SessionStrip.tsx`, `LeftDock.tsx`
- Modify: `packages/desktop/tests/lead-coordinator-wiring.test.ts`
- Modify: `packages/desktop/tests/lead-entry-wiring.test.ts`

**Interfaces:**
- Produces:
  - `type SessionRoleMetadata`
  - `isLeadRole(role?: string | null): boolean`（只接受 `lead`）
  - `tabSessionRole(tab?: { metadata?; lead?: boolean }): string | undefined`
  - `leadTabMetadata(): { mafw: { role: "lead" } }`
  - `type CoordinatorSession = { id; title; lead: true; metadata }`
  - `resolveLeadSession(input: { leadSessionId?: string | null }): CoordinatorSession | null`（无 history fallback）
  - session tab marker 从 `manager?: boolean` 改为 `lead?: boolean`

- [ ] **Step 1: Write failing tests**

`lead-session.test.ts`:
```ts
test('lead is the only current coordinator role', ...)
test('manager and manager-archived are ordinary history', ...)
test('lead tab marker maps to lead', ...)
test('resolved Lead uses supplied id even when absent from history', ...)
test('no lead id means no fallback to historical manager', ...)
```

Wiring:
- no imports of `manager-session`;
- no `isLeadSessionRole`;
- no `sessionRole === "manager"` fallback;
- ChatPane Lead lock still works.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-session.test.ts tests/lead-coordinator-wiring.test.ts`  
Expected: FAIL module missing/old aliases.

- [ ] **Step 3: Implement module and rename marker**

- Port only current-Lead utilities; do not include legacy alias behavior.
- Rename `manager` tab flag to `lead` across `SessionStrip`, `session-workspace`, `LeftDock`, `MafwShell`, `ChatPane` callers and tests.
- Update comments/copy to Lead only.
- `AgentPicker` may keep `manager` as deprecated agent key but must not treat `manager-archived` as Lead.
- Do not remove public manager API/preload in this task.

- [ ] **Step 4: Run focused tests**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-session.test.ts src/renderer/mafw/workspace/session-workspace.test.ts tests/lead-coordinator-wiring.test.ts tests/lead-entry-wiring.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/lead-session.ts packages/desktop/src/renderer/mafw/lead-session.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx packages/desktop/src/renderer/mafw/components/pickers/AgentPicker.tsx packages/desktop/src/renderer/mafw/workspace/session-workspace.ts packages/desktop/src/renderer/mafw/components/SessionStrip.tsx packages/desktop/src/renderer/mafw/components/LeftDock.tsx packages/desktop/tests/lead-coordinator-wiring.test.ts packages/desktop/tests/lead-entry-wiring.test.ts
git rm packages/desktop/src/renderer/mafw/manager-session.ts packages/desktop/src/renderer/mafw/manager-session.test.ts
git commit -m "refactor(desktop): make lead the only coordinator identity"
```

---

### Task 10: Pod as sole Lead UI authority

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pod-store.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/pod-collab-ui-wiring.test.ts`
- Test: `packages/desktop/tests/pod-tech-lead-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/layout-persist.test.ts`（如需要）

**Interfaces:**
- Consumes: Task 9 `resolveLeadSession({ leadSessionId })` 与 `leadTabMetadata()`。
- Produces:
  - `leadSessionIdFromPod(detail: PodDetail | null): string | null`：Lead member + live `node==='coordination'`，无 fallback。
  - `PodStoreApi.ensureLead(podID): Promise<PodLeadEnsureResult>`
  - `podStore.ensureLead(): Promise<PodLeadEnsureResult>`；成功后 `refresh()`。
  - `podStore.resolvedFor(projectDir): boolean`：只有 lookup 有**确定性结论**（成功、明确无 Pod、unsupported）时为 true；网络/未知错误仍为 false，不得据此 prune Lead tab。
  - `openPodSession` async：Lead → ensure → refresh → `openSessionTab(sessionId, "Lead", true, leadTabMetadata())`。
  - `openSessionTab` 对已存在 tab 补齐/更新 `lead` 与 metadata。

- [ ] **Step 1: Write failing tests**

```ts
test('leadSessionIdFromPod selects only live coordination session', ...)
test('leadSessionIdFromPod ignores ended coordination and other members', ...)
test('PodStore.ensureLead calls API then refreshes detail', ...)
test('PodStore.resolvedFor turns true when lookup definitively finds no Pod', ...)
test('PodStore.resolvedFor stays false on a transport/unknown error', ...)
test('openPodSession attaches lead metadata for both left and right Pod entries', ...)
test('reopening an existing role-less Lead tab upgrades its metadata', ...)
test('layout restore waits for Pod resolution and never reads manager fallback', ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts src/renderer/mafw/pod-store.test.ts tests/pod-collab-ui-wiring.test.ts tests/pod-tech-lead-wiring.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement Pod authority**

- Add `ensureLead` to PodStoreApi/defaultApi/type and API method.
- Add `resolvedDir`/`resolvedFor` state:
  - switching project clears it;
  - `open()` same-dir cache hit marks that dir resolved;
  - only definitive outcomes mark resolved; transport/unknown error does not.
- Replace MafwShell `fetchManagerSession`/`managerSessionId`/`managerSessionFor`/`managerSessionResolved`/`leadIdFor` with Pod detail:
  - startup/open project triggers `podStore.open(project)` before layout restore;
  - layout restore waits `resolvedFor(project)`;
  - keep set only when `leadSessionIdFromPod(detail)` is non-null;
  - no kv/history fallback.
- `openPodSession(sid,title)` becomes async:
  - compute route;
  - Lead: `const ensured=await podStore.ensureLead(); await podStore.refresh(); const lead=resolveLeadSession({ leadSessionId: ensured.sessionId }); openSessionTab(lead!.id, lead!.title, true, lead!.metadata)`。
  - Tech Lead behavior unchanged.
- `openSessionTab` updates existing tab’s `lead`/metadata when supplied.
- Update all `void openPodSession(...)` call sites.
- Keep `GET /api/manager/session` preload/SDK methods available for internal compatibility but no desktop reads.

- [ ] **Step 4: Run focused tests + typecheck**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts src/renderer/mafw/pod-store.test.ts tests/pod-collab-ui-wiring.test.ts tests/pod-tech-lead-wiring.test.ts`  
Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json`  
Expected: PASS/rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pod-model.ts packages/desktop/src/renderer/mafw/pod-model.test.ts packages/desktop/src/renderer/mafw/pod-store.ts packages/desktop/src/renderer/mafw/pod-store.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/pod-collab-ui-wiring.test.ts packages/desktop/tests/pod-tech-lead-wiring.test.ts
git commit -m "feat(desktop): make pod coordination the lead UI authority"
```

---

### Task 11: Welcome routes to Pod, retire manual Lead rotate

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx`
- Modify: `src/plugin.ts`
- Modify: `gateway/src/commands/registry.ts`
- Modify: `gateway/src/commands/builtin-handlers.ts`
- Test: `packages/desktop/tests/lead-entry-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/welcome-home.test.ts`（若不存在则创建纯逻辑/源码契约测试）
- Test: `gateway/tests/unit/mafw-command-registry.test.ts`
- Test: `gateway/tests/unit/mafw-command-builtin-handlers.test.ts`
- Test: `tests/plugin-v2.test.ts`

**Interfaces:**
- Consumes: Task 10 `ensureLead` / Pod entry.
- Produces:
  - `openLeadEntry(): Promise<boolean>` 打开左 dock `pod` face；无 Pod 保持空态，不自动创建。
  - `openNewGoalComposer(): void` 打开右工作台 `execution/pod` 的 work 面板。
  - Welcome props no longer include `onNewGoal`/旧 inline form/`planReview`.
  - no desktop "新话题" UI, `/new-topic` slash, plugin `new-topic`, gateway built-in `new-topic` handler/registration.
  - HTTP `POST /api/manager/session/rotate` remains internal compatibility.

- [ ] **Step 1: Write failing tests**

Desktop wiring:
- Welcome has no `goalDraft`/`goalInputOpen`/`planReview`/`submitGoal`;
- Lead button calls Pod entry, New Goal calls Pod composer;
- no ChatPane new-topic button/slash;
- Dashboard contains Lead not Manager.

Command/plugin:
- built-in command names exclude `new-topic`;
- plugin command list excludes `new-topic`;
- manager rotate route still exists and still works (existing test unchanged).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test tests/lead-entry-wiring.test.ts`  
Run: `cd gateway; npx jest tests/unit/mafw-command-registry.test.ts tests/unit/mafw-command-builtin-handlers.test.ts --runInBand --forceExit`  
Run: `npm test -- tests/plugin-v2.test.ts`  
Expected: FAIL on old entries.

- [ ] **Step 3: Implement routing and rotation removal**

- Add `openLeftDockFace(face)` helper in MafwShell that persists open preference before state update.
- `openLeadEntry` opens Pod face; if detail absent, no create.
- `openNewGoalComposer` calls `openPodPanel("tasks")` and ensures work panel.
- Remove Welcome inline goal input and associated imports/state.
- Remove ChatPane `mafw-new-topic` entry and button; keep `/goal`.
- Remove `handleNewTopic`/`doRotateTopic` from MafwShell.
- Remove plugin `new-topic` command; remove gateway `BUILTIN_COMMAND_DEFS` and handler registration for `new-topic`; delete its handler tests/fixtures.
- Do not remove `manager.rotate`, `routes/manager-rotate.ts`, SDK manager namespace.

- [ ] **Step 4: Run focused tests**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test tests/lead-entry-wiring.test.ts`  
Run: `cd gateway; npx jest tests/unit/mafw-command-registry.test.ts tests/unit/mafw-command-builtin-handlers.test.ts tests/unit/manager-rotate.test.ts --runInBand --forceExit`  
Run: `npm test -- tests/plugin-v2.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/pages/Dashboard.tsx src/plugin.ts gateway/src/commands/registry.ts gateway/src/commands/builtin-handlers.ts packages/desktop/tests/lead-entry-wiring.test.ts gateway/tests/unit/mafw-command-registry.test.ts gateway/tests/unit/mafw-command-builtin-handlers.test.ts tests/plugin-v2.test.ts
git commit -m "refactor(lead): route welcome to pod and retire manual rotate"
```

---

### Task 12: Contract docs, full verification, and GUI smoke

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture/gateway.md`
- Modify: `docs/architecture/plugin.md`
- Modify: `docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md`（只改与新裁决冲突的固定入口/rotate/revision continuity 段）
- Test: none（verification task）

**Interfaces:**
- Consumes: Tasks 1-11。
- Produces: 一致的文档契约和真实 GUI 冒烟证据。

- [ ] **Step 1: Update docs to the approved contract**

Record:
- Work rail has no fixed Lead/Manager row.
- Pod is the only project Lead entry; Welcome routes to Pod.
- Historical manager rows are ordinary readable history and never current.
- Lead replacement archives as `lead-archived`.
- Lead UI authority is active Pod coordination; explicit ensure only on entry.
- Tech Lead is revision-scoped; stale leases retired.
- Manual `new-topic` removed from desktop/plugin/gateway commands; HTTP rotate retained internal.
- Builder/Reviewer/Probe hidden.
- Queue bypass remains explicitly out of scope.

- [ ] **Step 2: Run full gateway suite**

Run: `cd gateway; npm test -- --runInBand --forceExit`  
Expected: all suites/tests PASS; record exact counts.

- [ ] **Step 3: Run SDK, desktop, root plugin tests**

Run: `cd packages/gateway-sdk; npm test`  
Run: `cd packages/desktop; npm test`  
Run: `npm test -- tests/plugin-v2.test.ts`  
Expected: PASS; record counts.

- [ ] **Step 4: Run builds/typechecks**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`  
Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json; npx electron-vite build`  
Run: `npm run build`（root，含 gateway/SDK/TUI）  
Expected: rc=0 for each.

- [ ] **Step 5: Real GUI smoke**

With repo gateway + desktop dev:

1. 工作 rail 不再出现固定 Lead/Manager 行；历史 Manager 会话在普通时间分组。
2. 左右鲸群 Lead 都能打开同一 tab，标题 `Lead`，agent 锁/invite 正常；重复点击不建重复 tab。
3. Welcome「Lead 会话」进入鲸群；无 Pod 项目显示空态且不自动建 Pod。
4. Welcome「新建 Goal」打开 Pod composer。
5. Pod 中 Lead 状态/Goal/attention 与工作 rail 不再互相矛盾。
6. Builder/Reviewer/Probe 不出现在普通会话列表，Pod transcript 可读。
7. 重启 gateway、reload desktop 后 Lead tab 恢复且身份仍正确。
8. 当前“kv 缺失 + Pod active”形态经显式 ensure 后只剩一个当前 Lead，旧 Manager 不冒充。
9. 若无真实 Goal 可用，使用测试 Pod 目标走 Goal→revision smoke；不得宣称未执行的 Plan/Review 路径已验证。

- [ ] **Step 6: Commit docs and final verification notes**

```bash
git add AGENTS.md docs/architecture/gateway.md docs/architecture/plugin.md docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md
git commit -m "docs(lead): align pod lead surface and lifecycle contract"
```

---

## Final Review Checklist

- [ ] 工作 rail 无 `ManagerCard`/`.mafw-manager-row`，历史 Manager 未消失。
- [ ] `LeadSessionRegistry` 覆盖 kv/Pod 四种组合、raw-key 冲突、active runtime slot。
- [ ] GET/lookup 轮询无创建副作用；显式 ensure 才修复。
- [ ] 旧 Lead snapshot + `lead-archived`；旧 coordination 只有一个是 active。
- [ ] Pod 打开 Lead 的标题、角色、already-open tab 升级均有测试。
- [ ] Layout restore 不因 Pod 加载先后 prune Lead tab。
- [ ] Builder/Reviewer/Probe 隐藏且 transcript 可读。
- [ ] revision N 退休不影响 N+1；stale sweep 不误伤当前在飞 revision。
- [ ] `new-topic` 用户入口全部消失，internal rotate API 仍在。
- [ ] 调度队列绕过未混入本批。
- [ ] 全量测试、typecheck、build、GUI smoke 全部有真实输出与计数。
