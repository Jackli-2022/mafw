# Batch 3 — Subagent Full Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline).

**Goal:** Add gateway-owned subagent spawn/list/message/cancel/result, depth lineage, synthetic `session.created`, and spawn/message/result tools for both plugin and pi.

**Architecture:** A `SubagentService` wraps runtime session APIs + structured output. Inline gateway routes expose it. Spawn broadcasts a canonical `session.created` with `info.parentID/depth`; desktop tracker/dock consume it. Tools call the routes with the caller's session ID.

**Spec:** `docs/superpowers/specs/2026-10-26-batch3-subagent-fullstack-design.md`

**Status:** Implemented in `1da5ec3e` (SubagentService/routes/depth/children), `cf6c3fbc` (depth-aware desktop tree), `eef2191d` (spawn/message/result tools). Verification: gateway 2589/2589, desktop 1418/1418, session-ui 89/89, SDK 143/143, TUI 224 (1 smoke skip), root build rc=0. Live smoke: spawn 200 (`parentID`, `depth:1`), list status completed, result `child-ok`, synthetic `session.created` carried parentID/depth on `/api/events`.

## Global Constraints

- No new canonical event types; reuse `session.created/updated` + `turn.*`.
- Parent/child ownership is validated server-side; never trust a body-supplied parent.
- Spawn uses `SdkSessionResource.promptAsync` so outputSchema instruction/registration works.
- Routes are inline near `/children`; do not add to route-catalog/SDK in this batch.
- Native `subagent` remains supported; list merges untracked runtime children.
- Do not touch parallel B3.1 docs.

## Review Focus

- Child created but prompt fails — record failed, don't crash the route.
- Deleted child during list/result — fail-open to aborted, no 500.
- Depth chain with missing parent — depth fallback 1, no infinite loop (cap 32).
- Duplicate `session.created` (runtime + synthetic) — tracker dedupes; no double rows.
- Message/cancel/result for a child of another parent — 404, no cross-session action.
- Structured result exists but no assistant text — result prefers structured.
- Legacy direct children without records — list/children still include them with depth.

---

### Task 1: SubagentService + routes

**Files:**
- Create: `gateway/src/runtime/subagent-service.ts`
- Test: `gateway/tests/unit/runtime/subagent-service.test.ts`
- Create: `gateway/src/routes/subagents.ts`
- Test: `gateway/tests/unit/routes/subagents.test.ts`
- Modify: `gateway/src/index.ts` (instantiate service + inline routes; children depth)
- Modify: `gateway/src/runtime/contract.ts` (`SessionInfo.depth?` optional)

**Interfaces:**
- `SubagentService` constructor deps as spec §4.1; methods `spawn/list/message/cancel/result/depthOf`.
- Route handler `handleSubagents(req,res,url,deps)` or separate functions; choose pure helpers for tests.

- [ ] **Step 1: Write failing service tests** with a fake runtime:
  - spawn creates child with parentID, prompts, records depth 1, broadcasts `session.created` with info.parentID.
  - list merges a native child not in records; status maps `time.idle`/`outcome`.
  - message/cancel/result reject wrong parent; result prefers `submitted`.
  - `depthOf` walks parent chain and caps at 32.
- [ ] **Step 2: Implement service**.
- [ ] **Step 3: Route tests** for spawn 200/400, list, message/cancel/result 404/200.
- [ ] **Step 4: Implement inline routes in `index.ts`** and instantiate:
  ```ts
  this.subagentService = new SubagentService({
    createSession: (o) => this.runtime!.session.create(o),
    getSession: (sid) => this.runtime!.session.get({ sessionID: sid }),
    promptChild: (o) => this.sdkSession.promptAsync(o.sessionID, o.prompt, undefined, o.agent, o.model, o.outputSchema),
    messageChild: (sid, text) => this.runtime!.session.promptAsync({ sessionID: sid, parts: [{type:'text',text}], delivery:'queue' }),
    abortChild: (sid) => this.runtime!.session.abort({ sessionID: sid }),
    messages: (sid, limit) => this.runtime!.session.messages({ sessionID: sid, limit }),
    submitted: (sid) => structuredOutput.submitted(sid),
    broadcast: (e) => this.broadcast(e),
  });
  ```
  Route regexes exactly before the children route; URL parse body helper.
- [ ] **Step 5: children depth**: in the children route, add `depth: await this.subagentService.depthOf(id) + 1` to each item.
- [ ] **Step 6: run service/route tests + tsc; commit** `feat(runtime): subagent service and gateway spawn/message/cancel/result routes`.

---

### Task 2: Depth-aware desktop tree

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/subagent-tracker.ts` (`depth?`)
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/subagents.ts` (`depth` passthrough)
- Create: `packages/desktop/src/renderer/mafw/subagent-tree.ts` (`descendantRows`)
- Test: `subagent-tracker.test.ts`, `subagent-tree.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/SubagentDock.tsx` (descendants + indent)

- [ ] **Step 1: Write failing tests**:
  - `session-created` with `depth:2` row stores depth.
  - `children-snapshot` child `{id, depth:2}` stores depth.
  - `descendantRows(rows, root)` returns root's children + grandchildren recursively, no cycles.
- [ ] **Step 2: Implement** `depth?: number` in `SubagentRow`/TrackerEvent; default 1; `descendantRows` DFS with visited Set.
- [ ] **Step 3: Dock**:
  ```ts
  const rows = () => descendantRows(subagentRows(), props.activeSessionId ?? "").filter(...)
  style={{ "padding-left": `${8 + Math.max(0, (r.depth ?? 1) - 1) * 12}px` }}
  ```
- [ ] **Step 4: run desktop tests + tsgo + build; commit** `feat(desktop): depth-aware subagent tree in dock`.

---

### Task 3: Spawn/message/result tools (plugin + pi)

**Files:**
- Create: `src/tools/spawn-subagent.ts`, `src/tools/message-subagent.ts`, `src/tools/subagent-result.ts`
- Modify: `src/plugin.ts` (register 3 tools)
- Modify: `gateway/src/runtime/mafw-tools.ts` (3 pi tools)
- Modify: `gateway/src/runtime/tool-classes.ts` (annotations)
- Tests: `gateway/tests/unit/runtime/mafw-tools.test.ts`, `mafw-tools-annotations.test.ts`, `pi-mafw-host-extension.test.ts`, `routes/tools.test.ts`

- [ ] **Step 1: Plugin tools** use `ctx.sessionID`:
  - spawn POST `/api/sessions/${ctx.sessionID}/subagents` body `{agent,description,prompt,background,model,outputSchema}`.
  - message POST `/api/sessions/${ctx.sessionID}/subagents/${args.sessionID}/message` body `{message}`.
  - result GET `/api/sessions/${ctx.sessionID}/subagents/${args.sessionID}/result`.
  - Return `{title, output, isError?}`; fail-open gateway unreachable.
- [ ] **Step 2: Pi tools** same HTTP paths with `sessionId` from factory; `postToolJson` for spawn/message, `GET` for result via `fetch` (use `postToolJson`? It POSTs; implement a `getToolJson` helper or use `f(base+path)` with auth? The factory fetch is a plain fetch; the gateway is loopback no auth for these routes. Use `f(base+path)` and parse.)
- [ ] **Step 3: annotations**:
  ```ts
  mafw_spawn_subagent: { readOnlyHint:false, destructiveHint:false },
  mafw_message_subagent: { readOnlyHint:false, destructiveHint:false },
  mafw_subagent_result: { readOnlyHint:true, idempotentHint:true },
  ```
- [ ] **Step 4: update test counts** 7→10:
  - `SEVEN` → `TEN` with 3 names; size 10; factory 10; annotations length 10; pi host expected names; routes/tools length 10.
  - Add tool handler tests (spawn body has parent from ctx, not model; result GET).
- [ ] **Step 5: run tests + root build; commit** `feat(tools): gateway subagent spawn/message/result tools`.

---

### Task 4: Live verification + deploy

- [ ] Gateway full `npx jest --runInBand --forceExit`, desktop full, SDK/session-ui/TUI.
- [ ] Root build; pack/install/restart.
- [ ] Live scratch session `C:/work`:
  1. POST `/api/sessions/:parent/subagents` with prompt "reply exactly child-ok" + model; inspect 200 id/depth.
  2. Capture `/api/events`: synthetic `session.created` info.parentID/depth.
  3. Wait, GET list/result; assert status/ text.
  4. message route 200; cancel route 200; parent/child mismatch 404.
- [ ] Update spec/plan status; deploy; report.

## Self-Review

- [x] Spec coverage: spawn/list/message/cancel/result, depth, synthetic event, native merge, tools, desktop tree.
- [x] Failure modes: prompt failure, deleted child, depth cap, duplicates, ownership, structured preference, untracked children.
- [x] No new vocabulary/route catalog; native subagent preserved.
