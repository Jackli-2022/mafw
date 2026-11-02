# Agent Create Mode (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Desktop Creator flow where `mafw-create` uses read-only inspection and approved plugin-manager tools to author, check, install, verify, and hot-iterate the unified declarative package from Phase 1.

**Architecture:** A gateway-owned draft store maps a Creator session to `~/.mafw/plugin-drafts/<draftId>`. The Creator identity can edit only that draft and calls two narrow tools: read-only inspect and approved plugin-manager operations. Installation always goes through Phase 1 `PackageManager`; Desktop only creates/binds the session and observes normal plugin revisions.

**Tech Stack:** TypeScript, gateway IdentityRegistry, MCP tools, Jest, SolidJS desktop, Phase 1 plugin contract/manager, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md` §15

**Prerequisite:** Phase 1 plan `docs/superpowers/plans/2026-11-03-unified-declarative-plugin-packages.md` is complete and its acceptance checks pass.

## Global Constraints

- Creator never writes `~/.mafw/plugins/<name>` directly; only `PackageManager.installFromPath` installs.
- One draft maps to one Creator session and survives gateway/Desktop restart.
- Entering Creator does not auto-send a message, clear composer drafts, or change the normal new-session default.
- `mafw_plugin_inspect` is read-only. `mafw_plugin_manager` writes require per-call approval unless the session is full-access; denial/cancel/unavailable means no mutation.
- Write operations use idempotency keys and return `{saved, application, activeRevision?, pendingRevision?, error?, nextStep}`.
- Host code installation remains trusted local code; check is validation, not a security sandbox.
- Active-runtime changes stay pending and require explicit `applyPending`.
- Generated packages use only Phase 1 `plugin.json + index.js`, declarative UI, registered `plugin:*` events, and first-phase revisions.
- Real UI verification must target a connected MAFW page; a mock preview cannot claim activation.
- Every task ends with focused tests green and a commit. Final delivery reports new tests and full-suite counts.

## Review Focus

- Creator must not be able to redirect installation/delete paths outside the draft or plugin roots.
- A lost/retried install request must not create a second activation or duplicate revision.
- Denied or unavailable approval must leave both the draft and active plugin untouched.
- A broken first candidate must not leave partial active registrations; a broken update must keep the old active revision.
- Restarting Gateway/Desktop must recover the Creator session, draft path, and active/pending distinction without replaying writes.

---

### Task 1: Persistent Draft Store

**Files:**
- Create: `gateway/src/plugins/drafts.ts`
- Create: `gateway/tests/unit/plugins/drafts.test.ts`
- Modify: `gateway/src/index.ts` (construct with GatewayDatabase kv and `~/.mafw/plugin-drafts`)

**Interfaces:**
- Produces: `PluginDraftStore({ rootDir, kvGet, kvSet })`
- Produces: `create({ creatorSessionID }): PluginDraft`
- Produces: `get(draftId)`, `getBySession(sessionID)`, `bindSession(draftId, sessionID)`, `setPackageName(draftId, name)`, `setActiveRevision(draftId, revision?)`, `touch(draftId)`
- Produces: `PluginDraft { draftId; creatorSessionID; packageName?; directory; createdAt; updatedAt; activeRevision? }`
- Rejects invalid/absolute draft ids and paths outside the draft root.

- [ ] **Step 1: Write failing draft-store tests**

Cover creation under the configured root, opaque id, persistence through a fresh store instance, session lookup, package-name update, traversal/id rejection, and missing-corrupt kv fail-open without escaping root.

- [ ] **Step 2: Run tests and verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/plugins/drafts.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the draft store**

Use process-random IDs (`crypto.randomUUID` is acceptable) and `mkdir` with restrictive permissions. Persist metadata in `kv_store` scope `plugin-creator`. Return normalized immutable DTOs. Never delete a draft as part of plugin remove; add no cleanup API in this phase.

- [ ] **Step 4: Verify focused test and typecheck**

Run the Jest file — PASS.
Run in `gateway`: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/drafts.ts gateway/tests/unit/plugins/drafts.test.ts gateway/src/index.ts
git commit -m "feat(plugins): add persistent creator drafts"
```

### Task 2: Creator Identity, Skill, and Session API

**Files:**
- Create: `gateway/src/skills/plugin-creator-identity.ts`
- Create: `gateway/src/skills/plugin-creator-skill-install.ts`
- Create: `skills/plugin-creator/SKILL.md`
- Create: `gateway/src/routes/plugin-creator.ts`
- Create: `gateway/tests/unit/plugins/plugin-creator-identity.test.ts`
- Create: `gateway/tests/unit/plugins/plugin-creator-skill-install.test.ts`
- Create: `gateway/tests/unit/routes/plugin-creator.test.ts`
- Modify: `gateway/src/runtime/identity-registry.ts`
- Modify: `gateway/src/index.ts` (register identity, install skill, route deps)
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/wave2-handlers.ts`

**Interfaces:**
- Produces identity `mafw-create`, scope `primary`, description and system prompt from `plugin-creator-identity.ts`.
- Produces `ensurePluginCreatorSkill({ sourceDir, targetDir }): Promise<{ installed: boolean; path: string }>`; idempotently copies the packaged skill to `~/.config/opencode/skills/plugin-creator/` before serve startup, matching the existing office-skill installation pattern.
- Policy allows `readonly`, `file-edit`, `shell`, `mafw_plugin_inspect`, `mafw_plugin_manager`; denies unrelated web/subagent capability. User approval mode still decides mutations.
- Produces `POST /api/plugins/creator/session` → `{ sessionID, draftId, directory }`; creates a session with `directory = draft.directory`, calls `identityState.bind(sessionID, 'mafw-create', 'session')`, and records the creator binding.
- Produces `GET /api/plugins/creator/session?sessionID=` → `{ draft, agent: 'mafw-create' }`; re-binds the session identity after gateway restart when the persisted draft still names that session.
- Reuses existing session creation/permissions; no Creator-only approval bypass.

- [ ] **Step 1: Write failing identity and route tests**

Identity: name/policy registration, no runtime-specific fields, skill includes package contract/four UI slots/test-first workflow. Skill installer: idempotent copy, missing source fail-open with diagnostic, target path contained under the configured skills dir. Route: creates exactly one draft + one session, returns same draft on repeat lookup, unknown session 404, runtime unavailable 503, invalid body 400, and no automatic prompt is sent.

- [ ] **Step 2: Run tests and verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/plugins/plugin-creator-identity.test.ts tests/unit/routes/plugin-creator.test.ts`
Expected: FAIL because identity/routes do not exist.

- [ ] **Step 3: Implement identity, skill, and creator session route**

Use `IdentityRegistry` built-ins and `toAgentDefinition`; do not add a second materialization path. The Creator route creates the draft first, then the runtime session with the draft directory. If session creation fails, leave the draft unbound or clean only the newly created metadata so retry is deterministic. Register the route through the route catalog/registry dispatch.

- [ ] **Step 4: Verify focused tests, identity registry tests, and typecheck**

Run focused Jest files — PASS.
Run: `npx jest --runInBand tests/unit/runtime/identity-registry.test.ts` — PASS (or the nearest existing identity tests).
Run: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/skills/plugin-creator-identity.ts skills/plugin-creator gateway/src/routes/plugin-creator.ts gateway/tests/unit/plugins gateway/tests/unit/routes gateway/src/runtime/identity-registry.ts gateway/src/index.ts gateway/src/serve-sidecar.ts gateway/src/routes/route-catalog.ts gateway/src/routes/wave2-handlers.ts
git commit -m "feat(plugins): add creator identity and session"
```

### Task 3: Read-Only Plugin Inspection Tool

**Files:**
- Create: `gateway/src/plugins/plugin-inspect.ts`
- Create: `gateway/src/mcp/handlers/plugin-inspect.ts`
- Create: `gateway/tests/unit/plugins/plugin-inspect.test.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `gateway/src/index.ts` (register inspect service in tool services)
- Modify: `gateway/src/types.ts` (inspect service dependency)

**Interfaces:**
- Produces MCP tool `mafw_plugin_inspect` with input `{ query: 'clientDescriptors'|'actions'|'events'|'slots'|'widgetSchema'|'package'|'experience'; packageName?; draftId? }`.
- Produces `PluginInspectService.query(input): Promise<Record<string, unknown>>`.
- Returns sanitized descriptors plus Experience actions only; never runtime name, native SDK object, handler function, or file system contents outside `plugin.json`/manifest metadata.
- Does not execute plugin actions or business methods.

- [ ] **Step 1: Write failing inspect tests**

Cover each query kind, package filter, unknown query 400, no raw handler leakage, no runtimeName/capability flag leakage, no arbitrary file read via `draftId/packageName`, and stable JSON-serializable output.

- [ ] **Step 2: Run tests and verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/plugins/plugin-inspect.test.ts`
Expected: FAIL because the tool/service does not exist.

- [ ] **Step 3: Implement inspect service and MCP handler**

Project from Phase 1 client descriptors and package manager. For `experience`, read only the public Experience actions endpoint/service. Validate input before querying. Keep output below the configured tool result cap and return structured content.

- [ ] **Step 4: Verify focused tests, tool registry tests, and typecheck**

Run focused Jest — PASS.
Run: `npx jest --runInBand tests/unit/mcp/tool-registry.test.ts` — PASS.
Run: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-inspect.ts gateway/src/mcp/handlers/plugin-inspect.ts gateway/src/mcp/tool-registry.ts gateway/src/index.ts gateway/src/types.ts gateway/tests/unit/plugins/plugin-inspect.test.ts
git commit -m "feat(plugins): add read-only creator inspection"
```

### Task 4: Approved Plugin Manager Tool with Idempotency

**Files:**
- Create: `gateway/src/plugins/plugin-manager-tool.ts`
- Create: `gateway/src/core/approval/plugin-manager-approval.ts`
- Create: `gateway/src/mcp/handlers/plugin-manager.ts`
- Create: `gateway/tests/unit/plugins/plugin-manager-tool.test.ts`
- Create: `gateway/tests/unit/plugins/plugin-manager-approval.test.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/types.ts`

**Interfaces:**
- Produces MCP tool `mafw_plugin_manager` with operations `list`, `status`, `descriptor` (read-only) and `check`, `install`, `enable`, `disable`, `remove`, `applyPending`, `reload` (write).
- Input: `{ operation; draftId?; packageName?; overwrite?; requestId? }`.
- Produces `PluginManagerTool.execute(input, { sessionID }): Promise<PluginManagerResult>`.
- Produces `PluginManagerApproval.authorize({ sessionID, operation, packageName, overwrite }): Promise<{ allowed: boolean; reason?: string }>`, built on existing approval policy + human question/response path.
- Maintains an idempotency map keyed by `sessionID:requestId`; completed results return the saved outcome, in-flight duplicate joins the same promise.

- [ ] **Step 1: Write failing tool and approval tests**

Tool: read operations bypass write approval; every write asks; denial/cancel/unavailable leaves state unchanged; install only resolves a draft package already present under the draft root; overwrite requires explicit flag; duplicate requestId returns same result; pending result is not reported as applied; missing draft/package returns actionable errors. Approval: full-access auto-allows; read-only/human modes ask; policy deny rejects.

- [ ] **Step 2: Run tests and verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/plugins/plugin-manager-tool.test.ts tests/unit/plugins/plugin-manager-approval.test.ts`
Expected: FAIL because the tool and approval gate do not exist.

- [ ] **Step 3: Implement tool, approval adapter, and result DTO**

Use Phase 1 `PackageManager` and `PluginDraftStore`; do not duplicate install/check/reload logic. Require `draftId` for check/install and resolve its directory through the draft store. Use `requestId` or a deterministic hash of operation + draft + overwrite when absent. Return the spec's five-state result with neutral `nextStep`. Approval implementation uses the existing `ApprovalPolicyService`/question transport; do not create a new permission registry.

- [ ] **Step 4: Verify focused tests and full plugin suites**

Run both Jest files — PASS.
Run: `npx jest --runInBand tests/unit/plugins` — PASS.
Run: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-manager-tool.ts gateway/src/core/approval/plugin-manager-approval.ts gateway/src/mcp/handlers/plugin-manager.ts gateway/src/mcp/tool-registry.ts gateway/src/index.ts gateway/src/types.ts gateway/tests/unit/plugins
git commit -m "feat(plugins): add approved creator manager tool"
```

### Task 5: Creator API and Desktop Entry

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/creator-entry.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/creator-entry.test.ts`
- Create: `packages/desktop/src/renderer/mafw/pages/CreatorEntryButton.tsx`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
- SDK/preload: `plugins.createCreatorSession(): Promise<{ sessionID; draftId; directory }>` and `plugins.creatorSession(sessionID)`.
- Produces pure: `shouldEnterCreator({ rosterLoading, creatorAvailable, blankSession, composerText })`
- Desktop button label: “让 Agent 创建插件”; disabled with reason when unavailable.
- On click: create/bind blank Creator session, set its agent selection to `mafw-create`, open the session tab, do not send a prompt, do not modify other session drafts/default.

- [ ] **Step 1: Write failing entry/API tests**

Cover creator available/unavailable/loading states, preserved composer text, no prompt submission, created session opened, repeat click on a bound blank session reuses it, SDK paths/body correct, and default agent unchanged for a later new session.

- [ ] **Step 2: Run tests and verify failure**

Run in `packages/desktop`: focused `creator-entry.test.ts` — FAIL.
Run in `packages/gateway-sdk`: `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/client.test.ts` — FAIL on missing methods.

- [ ] **Step 3: Implement SDK/preload entry and Desktop button**

Add the entry in the existing Plugins add-plugin area. Use existing session creation/open-tab/agent-selection state; do not introduce a second session store. Store the returned draft/session binding in the plugin store for later display. Use `ToastV2` on refusal/failure.

- [ ] **Step 4: Verify focused tests, typecheck, and build**

Run focused Desktop tests and SDK test — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` in Desktop — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins packages/desktop/src/renderer/mafw/pages/CreatorEntryButton.tsx packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/preload packages/gateway-sdk
git commit -m "feat(desktop): enter creator mode from plugins"
```

### Task 6: Draft/Install Status in Plugin Manager UI

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pages/plugin-creator-status.ts`
- Create: `packages/desktop/src/renderer/mafw/pages/plugin-creator-status.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx`
- Modify: `packages/desktop/src/renderer/mafw/plugins/plugin-store.ts`

**Interfaces:**
- Produces pure: `creatorStatusModel({ draft, packageState, creatorSession })` returning status, revision, source session, and allowed actions.
- UI shows “创建中 / 已保存未安装 / 已安装 / pending / failed / disabled”.
- “打开创建会话” reopens the bound Creator session; absent session falls back to ordinary package management.

- [ ] **Step 1: Write failing status tests**

Cover all five statuses, failed candidate while old active remains, pending apply display, missing source session fallback, and disabled package with preserved draft.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/plugin-creator-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement status mapping and UI actions**

Merge draft metadata from the creator API with Phase 1 package state. Do not infer activation from filesystem or draft existence. Keep source-session navigation as a normal `openSessionTab` action.

- [ ] **Step 4: Verify tests and typecheck**

Run focused test — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages packages/desktop/src/renderer/mafw/plugins/plugin-store.ts
git commit -m "feat(desktop): show creator draft status"
```

### Task 7: Deterministic Creator Fixtures and End-to-End Tests

**Files:**
- Create: `gateway/tests/integration/plugin-creator-flow.test.ts`
- Create: `gateway/tests/fixtures/plugin-creator-tools.json`
- Modify: `gateway/package.json` test fixture copy only if needed

**Interfaces:**
- Fixture is an ordered tool-call transcript: inspect → write fixture draft files → check → install → panel/config action → edit title → check → install overwrite → delete.
- Test uses a fake approval gate returning allow/deny variants and a fake broadcast sink.
- No live LLM is required for the deterministic test.

- [ ] **Step 1: Write failing Creator flow integration test**

Cover allow path, denied install path, failed candidate rollback, pending active-runtime path, second iteration revision change, delete cleanup, and restart of the draft store between install steps.

- [ ] **Step 2: Run test and verify failure**

Run in `gateway`: `npx jest --runInBand tests/integration/plugin-creator-flow.test.ts`
Expected: FAIL until all Creator services are wired.

- [ ] **Step 3: Implement only the missing wiring/fixture support**

Do not add new production features in this task. Wire the gateway services, deterministic fixture loader, and test helpers. Any production defect discovered must be fixed in a separate failing test first.

- [ ] **Step 4: Verify integration test and full gateway plugin suites**

Run focused integration test — PASS.
Run: `npx jest --runInBand tests/unit/plugins tests/integration/plugin-creator-flow.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration gateway/tests/fixtures gateway/package.json
git commit -m "test(plugins): cover creator end-to-end flow"
```

### Task 8: Live Creator Smoke and Phase-2 Acceptance

**Files:**
- Create: `docs/guides/plugin-creator.md`
- No production files unless smoke finds a bug (fix via failing test first)

- [ ] **Step 1: Run deterministic full verification**

Run:
- `npm test --prefix gateway -- --runInBand`
- `npm test -w @mafw/sdk`
- `npm test -w @mafw/desktop`
- `npx tsc --noEmit` in `gateway`
- `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` in Desktop
- contract freshness/API contract tests

Expected: all pass; record exact new-test and total counts.

- [ ] **Step 2: Run the real model + real Desktop smoke**

Open Plugins → “让 Agent 创建插件”. Confirm no prompt auto-send and prior composer draft unchanged. Ask for a plugin with panel, config page, tool card and message window. Verify inspect is called first, draft files stay under `plugin-drafts/<draftId>`, denied install causes no active mutation, approved install activates, real UI is visible, a second iteration hot-reloads, a broken candidate keeps the old revision, restart recovers the session/draft, and remove cleans active contributions while retaining the draft.

- [ ] **Step 3: Document setup, approvals, draft location, recovery, and limitations**

`docs/guides/plugin-creator.md` must cover Creator entry, required permissions, draft/source location, retry/idempotency, how to disable a broken plugin, how to return to the Creator session, and the explicit non-goals (no arbitrary Client code, no malicious Host sandbox, no permanent approval escalation).

- [ ] **Step 4: Fix any smoke defect test-first, then rerun full verification**

Write the failing regression test before the fix. Commit only smoke fixes and the guide.

- [ ] **Step 5: Commit**

```bash
git add docs/guides/plugin-creator.md <smoke-fix-files>
git commit -m "feat(plugins): complete agent create mode"
```
