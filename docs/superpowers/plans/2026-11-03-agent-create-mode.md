# Agent Create Mode (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Creator flow where a normal blank Session bound to `mafw-create` authors a unified plugin package under the current project's `.mafw/plugin-drafts/`, then checks, tests, installs, and iterates it through existing MAFW plugin management with per-call native approval.

**Architecture:** There is no dedicated Creator session or draft database. The Desktop entry reuses or creates an ordinary Session and switches its agent through the existing `switchAgent`/session-config path. Two plugin-native tools (`mafw_plugin_inspect`, `mafw_plugin_manager`) use the real tool context for `sessionID`/`directory`/`ask`; the manager tool resolves a project-local draft, performs a native approval, and calls the existing package REST endpoints or the fixed draft test runner. Phase 1 `PackageManager` remains the only installer and revision owner.

**Tech Stack:** TypeScript, OpenCode V2 plugin `ctx.tool.transform`, native `ctx.ask`, Gateway identity registry, Jest, SolidJS Desktop, Phase 1 plugin contract/manager, `node:test` fixture.

**Spec:** `docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md` §15

## Global Constraints

- Creator uses a normal blank Session; do not add a Creator Session type, REST/SDK/preload endpoint, draftId, draft↔session binding, or gateway draft kv.
- Draft root is `<project>/.mafw/plugin-drafts/<packageName>/`; never rewrite the Session cwd.
- Only `PackageManager` installs packages. `applyPending` is user-only in the Plugins page and is not a model operation.
- `check`, `test`, and mutating manager operations require native per-call approval unless the Session is `full-access`.
- Approval uses the tool context's awaitable `ask` with `always: []`; no persisted/session-wide grant is added.
- Creator has no shell, web, subagent, goal, pod, task, python, media, desktop, automation, or restart tools.
- Creator must be able to load its own `plugin-creator` skill: `skill` is explicitly enabled in `tools` and allowed by policy even though the rest of the surface uses `'*': false`.
- `check` and `test` execute trusted local draft code; neither is a sandbox. Fixed test command is `node --test`, cwd is the draft, timeout 60s, sanitized env, capped output.
- A new draft iteration uses a new request id. Never derive idempotency keys from `(operation, draft, overwrite)`.
- No new Desktop renderer→gateway diagnostics or screenshot channel. Creator reads descriptors and Host/activation diagnostics; visual issues come from the user.
- Worktree Sessions do not expose the Creator entry.
- Every task ends with focused tests green and a commit. Final delivery reports new and full-suite test counts.

**Separate prerequisites (not implemented by this plan):** land the pre-existing registry-dispatch auth-order P0 hotfix before exposing the gateway beyond loopback; land scan/check `main` realpath containment and name-scoped reload before treating generated drafts as broadly distributable. These are tracked Phase 1 debt, not Creator scope.

## Review Focus

- Native approval unavailable, rejected, or accidentally bypassed by `auto` mode must never mutate plugins; tests live in Task 3 and Task 4.
- Draft names containing `..`, absolute paths, separators, or symlink escapes must fail before approval or HTTP; tests live in Task 4.
- The fixed test runner must not hang, inherit secrets, or return unbounded output; tests live in Task 4.
- Draft content changing between approval and execution, or a replayed request id hiding a new iteration, must be rejected; tests live in Task 4 and Task 6.
- Entering Creator from a worktree, with a missing agent, or while preserving another Session's composer draft must not change the normal new-Session default; tests live in Task 5.
- `tools['*'] = false` must not hide the Creator skill itself; tests live in Task 1.

---

### Task 1: Creator Identity and Shipped Skill

**Files:**
- Create: `gateway/src/core/skills/global-skill.ts`
- Modify: `gateway/src/core/office/global-skill.ts`
- Create: `gateway/src/skills/plugin-creator-skill-install.ts`
- Create: `gateway/src/skills/plugin-creator-identity.ts`
- Create: `skills/plugin-creator/SKILL.md`
- Modify: `gateway/src/runtime/identity-registry.ts`
- Modify: `gateway/src/index.ts` (install the skill before serve startup)
- Create: `gateway/tests/unit/skills/plugin-creator-identity.test.ts`
- Create: `gateway/tests/unit/skills/plugin-creator-skill-install.test.ts`

**Interfaces:**
- Consumes: existing `AgentDefinition`, `AgentPermissions`, `IdentitySpec`, `toAgentDefinition`.
- Produces: `getPluginCreatorAgentDefinition(): AgentDefinition`
- Produces: `ensurePluginCreatorSkill(opts?: { sourceRoot?: string; skillsDir?: string; sourceFile?: string }): Promise<EnsureSkillResult>` with the existing Office result shape.
- Produces: `ensureGlobalSkill({ skillName, sourceRoot?, skillsDir?, sourceFile? }): Promise<EnsureSkillResult>` and `globalSkillTarget(skillName, skillsDir?)`.

- [ ] **Step 1: Write failing identity and skill tests**

`plugin-creator-identity.test.ts` asserts the exact boundary:

```ts
const def = getPluginCreatorAgentDefinition()
expect(def.mode).toBe('primary')
expect(def.permissions.bash).toBe('deny')
expect(def.permissions.edit).toBe('ask')
expect(def.permissions.tools?.mafw_plugin_manager).toBe('ask')
expect(def.tools?.['*']).toBe(false)
expect(def.tools?.skill).toBe(true)
expect(def.tools?.mafw_plugin_inspect).toBe(true)
expect(def.tools?.mafw_plugin_manager).toBe(true)
expect(def.tools?.bash).not.toBe(true)
expect(def.systemPrompt).toContain('plugin-creator')
expect(def.systemPrompt).toContain('.mafw/plugin-drafts/<packageName>')
expect(def.systemPrompt).toContain('mafw_plugin_manager')
expect(def.systemPrompt).toContain('applyPending')
expect(def.systemPrompt).not.toContain('maxWidgets')
expect(def.systemPrompt.length).toBeLessThan(1_500)
```

Also assert the registry includes `mafw-create` with `scope: 'primary'`, no pinned model, an allowlist containing `skill`/`mafw_plugin_inspect`/`mafw_plugin_manager`, and denial of `shell`/`web`/`subagent`. Assert `toAgentDefinition(spec)` is byte-shape compatible with `getPluginCreatorAgentDefinition()`.

`plugin-creator-skill-install.test.ts` covers install → unchanged → update, missing source fail-open, and a target contained under the supplied skills directory. Existing Office global-skill tests must remain green after the generic extraction.

- [ ] **Step 2: Run tests to verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/skills/plugin-creator-identity.test.ts tests/unit/skills/plugin-creator-skill-install.test.ts tests/unit/office/global-skill.test.ts`
Expected: FAIL because the Creator modules do not exist.

- [ ] **Step 3: Implement generic skill installation and Creator identity**

Extract the atomic write logic from Office into `core/skills/global-skill.ts`; make the Office module delegate without changing its public signatures. Implement the Creator installer with skill name `plugin-creator`.

`getPluginCreatorAgentDefinition()` returns:

```ts
{
  description: '创建 MAFW 统一插件包并迭代到真实 Desktop',
  mode: 'primary',
  systemPrompt: PLUGIN_CREATOR_SYSTEM_PROMPT,
  permissions: {
    edit: 'ask',
    bash: 'deny',
    tools: {
      question: 'allow',
      plan_exit: 'allow',
      mafw_plugin_manager: 'ask',
    },
  },
  tools: {
    '*': false,
    skill: true,
    read: true,
    grep: true,
    glob: true,
    list: true,
    edit: true,
    write: true,
    question: true,
    todowrite: true,
    mafw_plugin_inspect: true,
    mafw_plugin_manager: true,
    mafw_add_memory: true,
    mafw_search_hybrid: true,
    mafw_get_memory: true,
  },
}
```

`PLUGIN_CREATOR_SYSTEM_PROMPT` is the thin invariant layer only; it must stay under 1,500 characters and avoid package schemas, widget limits, templates, or the full workflow. It requires: load `plugin-creator` before the first inspect/write and stop if unavailable; use project-local drafts; route all mutations through `mafw_plugin_manager`; keep `applyPending` user-only; never conflate saved/tested/installed/active/pending.

Create `skills/plugin-creator/SKILL.md` as the sole detailed source for: package layout, four UI slots, widget/action/event limits, templates, inspect-first ordering, test-first workflow, approval/fingerprint/requestId semantics, verification, recovery, and common failures. Identity and skill must not both carry the detailed tutorial.

Register the identity in `buildBuiltins()`, and install the skill beside the Office skill before serve startup in `gateway/src/index.ts`.

- [ ] **Step 4: Run focused tests and typecheck**

Run in `gateway`:
- `npx jest --runInBand tests/unit/skills tests/unit/office/global-skill.test.ts tests/unit/runtime/identity-registry.test.ts`
- `npx tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/skills/global-skill.ts gateway/src/core/office/global-skill.ts gateway/src/skills/plugin-creator-skill-install.ts gateway/src/skills/plugin-creator-identity.ts skills/plugin-creator/SKILL.md gateway/src/runtime/identity-registry.ts gateway/src/index.ts gateway/tests/unit/skills gateway/tests/unit/office/global-skill.test.ts
git commit -m "feat(plugins): add creator identity and skill"
```

---

### Task 2: Read-Only Plugin Inspection Tool

**Files:**
- Create: `src/tools/plugin-common.ts`
- Create: `src/tools/plugin-public-contract.ts`
- Create: `src/tools/plugin-inspect.ts`
- Modify: `src/plugin.ts` (register `mafw_plugin_inspect`)
- Create: `tests/plugin-creator-tools.test.ts`
- Modify: `tests/plugin-v2.test.ts` (tool count and names)
- Modify: `package.json` (`test:creator`)
- Modify: `.github/workflows/ci.yml` (run `npm run test:creator`)

**Interfaces:**
- Consumes: existing `GET /api/plugins`, `GET /api/plugins/client`, `GET /api/experience/actions`.
- Produces: `PluginToolContext` with `sessionID`, optional `abort`, optional `directory`, optional `agent`, optional `ask({ permission, patterns, always }): Promise<void>`.
- Produces: `pluginGatewayGet(path, ctx): Promise<unknown>` and `pluginGatewayPost(path, body, ctx): Promise<unknown>`.
- Produces: `PLUGIN_PUBLIC_CONTRACT` containing the four slot names, Widget type names, and exact `PLUGIN_UI_LIMITS` values.
- Produces: `pluginInspectTool` with args `{ query: 'clientDescriptors'|'actions'|'events'|'slots'|'widgetSchema'|'package'|'experience'; packageName?: string }`.

- [ ] **Step 1: Write failing inspect tests**

Add to `tests/plugin-creator-tools.test.ts`:

```ts
test('slots and widgetSchema expose the public contract only', async () => {
  const slots: any = await pluginInspectTool.execute({ query: 'slots' }, ctx)
  expect(JSON.parse(slots.output).slots).toEqual([
    'panels', 'toolCards', 'configPages', 'messageWindows',
  ])
  const schema: any = await pluginInspectTool.execute({ query: 'widgetSchema' }, ctx)
  expect(JSON.parse(schema.output).limits.maxWidgets).toBe(256)
})

test('package projection never leaks runtime names or handlers', async () => {
  mockPluginFetch({ runtimeName: 'opencode', handler: () => 1, name: 'acme' })
  const result: any = await pluginInspectTool.execute(
    { query: 'package', packageName: 'acme' }, ctx,
  )
  expect(result.output).toContain('acme')
  expect(result.output).not.toContain('runtimeName')
  expect(result.output).not.toContain('handler')
})
```

Also cover every query kind, unknown package, stable JSON serialization, a 128 KiB cap with `truncated: true`, and a contract-sync assertion comparing `PLUGIN_PUBLIC_CONTRACT.limits` with `packages/plugin-contract/src/limits.ts`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx jest tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts --runInBand`
Expected: FAIL because the inspect tool is not registered.

- [ ] **Step 3: Implement the inspect tool and register it**

`pluginGatewayGet` reads the port from `MAFW_SERVER_API_PORT || MAFW_GATEWAY_PORT || '3000'`, adds a 5s abort timeout composed with `ctx.abort`, and throws a readable error for non-2xx bodies.

The overlay registers `mafw_plugin_inspect` in `V1_TOOLS`. It projects only public fields:

- inventory: `name`, `version`, `status`, `contributions`, `activeRevision`, `pendingRevision`, diagnostics;
- client descriptors: UI/actions/events/config descriptors and diagnostics;
- package filter: exact `packageName`, missing returns an empty package result;
- experience: only the public Experience response; strip `runtimeName` recursively.

Add root script:

```json
"test:creator": "jest tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts --runInBand"
```

Update the plugin registration test from 20 tools to 21 and assert `mafw_plugin_inspect` is present; the manager tool raises it to 22 in Task 4.

- [ ] **Step 4: Run focused tests and build**

Run:
- `npm run test:creator`
- `npm run build`

Expected: PASS; build exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/tools/plugin-common.ts src/tools/plugin-public-contract.ts src/tools/plugin-inspect.ts src/plugin.ts tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts package.json .github/workflows/ci.yml
git commit -m "feat(plugins): add creator contract inspection"
```

---

### Task 3: Native Approval Bridge

**Files:**
- Create: `src/tools/plugin-approval.ts`
- Modify: `src/plugin.ts` (forward `ask`, `directory`, `agent` through `adaptToolExecute`)
- Modify: `tests/plugin-creator-tools.test.ts`
- Modify: `tests/plugin-v2.test.ts` (assert executor context forwarding)

**Interfaces:**
- Consumes: `PluginToolContext`, `pluginGatewayGet`.
- Produces: `CREATOR_PERMISSION = 'mafw_plugin_manager'`.
- Produces: `approveCreatorOperation(ctx, { operation, patterns }): Promise<void>`.
- Produces: plugin executor context forwarding `sessionID`, `abort`, `directory`, `agent`, and `ask` when present.

- [ ] **Step 1: Write failing approval tests**

```ts
test('non-full-access asks with always empty', async () => {
  const ask = jest.fn(async () => undefined)
  mockSessionMode('read-only')
  await approveCreatorOperation({ ...ctx, ask }, {
    operation: 'install',
    patterns: ['install acme draft=acme overwrite=true fp=abcdef123456'],
  })
  expect(ask).toHaveBeenCalledWith({
    permission: 'mafw_plugin_manager',
    patterns: ['install acme draft=acme overwrite=true fp=abcdef123456'],
    always: [],
  })
})

test('full access skips the human prompt', async () => {
  mockSessionMode('full-access')
  const ask = jest.fn()
  await approveCreatorOperation({ ...ctx, ask }, { operation: 'check', patterns: ['check acme'] })
  expect(ask).not.toHaveBeenCalled()
})

test('unavailable approval fails closed', async () => {
  mockSessionMode('auto')
  await expect(approveCreatorOperation(ctx, { operation: 'check', patterns: ['check acme'] }))
    .rejects.toThrow('native approval unavailable')
})
```

Also test that `auto` mode still asks, a rejected `ask` propagates, and a failed mode lookup falls back to asking, not auto-allowing.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx jest tests/plugin-creator-tools.test.ts --runInBand`
Expected: FAIL because `approveCreatorOperation` does not exist.

- [ ] **Step 3: Implement approval forwarding and helper**

In `adaptToolExecute`, build:

```ts
const toolCtx = {
  sessionID: context?.sessionID,
  abort: context?.signal,
  directory: context?.directory,
  agent: context?.agent,
  ...(typeof context?.ask === 'function'
    ? { ask: (input: any) => context.ask(input) }
    : {}),
}
```

`approveCreatorOperation`:

1. GET `/api/session/<sessionID>/config` using `pluginGatewayGet`.
2. If the returned `mode === 'full-access'`, return without asking.
3. If mode lookup fails, continue to ask (fail closed).
4. If `ctx.ask` is missing, throw `native approval unavailable`.
5. Otherwise `await ctx.ask({ permission: CREATOR_PERMISSION, patterns, always: [] })`.

Do not use the gateway `ApprovalPolicyService` as a substitute; this tool runs in the host tool pipeline and its native prompt is the contract.

- [ ] **Step 4: Run focused tests and plugin registration tests**

Run: `npx jest tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/plugin-approval.ts src/plugin.ts tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts
git commit -m "feat(plugins): add native creator approvals"
```

---

### Task 4: Creator Plugin Manager Tool

**Files:**
- Create: `src/tools/plugin-draft.ts`
- Create: `src/tools/plugin-test-runner.ts`
- Create: `src/tools/plugin-manager.ts`
- Modify: `src/plugin.ts` (register `mafw_plugin_manager`)
- Modify: `tests/plugin-creator-tools.test.ts`
- Modify: `tests/plugin-v2.test.ts`

**Interfaces:**
- Consumes: `approveCreatorOperation`, `PluginToolContext`, gateway REST endpoints.
- Produces: `resolveDraftDirectory(projectDir: string, draft: string): string`.
- Produces: `fingerprintDraft(directory: string): Promise<string>` (SHA-256 over every accepted relative file path and contents; accepted set must equal the install copy set; rejects more than 5,000 files or 50 MiB).
- Produces: `runDraftTests(directory: string, deps?: { spawn?: typeof spawn; timeoutMs?: number; maxBytes?: number }): Promise<{ output: string; truncated: boolean; exitCode: number | null; timedOut: boolean }>`.
- Produces: `pluginManagerTool` with operations `list|status|descriptor|check|test|install|enable|disable|remove|reload`.

- [ ] **Step 1: Write failing manager tests**

Cover:

```ts
test('install asks with package fingerprint and uses the draft path', async () => {
  const ask = jest.fn(async () => undefined)
  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme', overwrite: true, requestId: 'req-1' },
    { ...ctx, ask },
  )
  expect(ask.mock.calls[0][0].patterns[0]).toMatch(/^install acme draft=acme overwrite=true fp=/)
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/plugins/packages/install'),
    expect.objectContaining({ method: 'POST' }),
  )
  expect(result.isError).not.toBe(true)
})

test('draft traversal and symlink escapes are rejected before approval', async () => {
  const ask = jest.fn()
  const result: any = await pluginManagerTool.execute({ operation: 'check', draft: '../outside' }, { ...ctx, ask })
  expect(result.isError).toBe(true)
  expect(result.output).toContain('invalid draft')
  expect(ask).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('changed content between approval and execution aborts the install', async () => {
  const ask = jest.fn(async () => { await appendFile(indexPath, '\n// changed') })
  const result: any = await pluginManagerTool.execute({ operation: 'install', draft: 'acme' }, { ...ctx, ask })
  expect(result.isError).toBe(true)
  expect(result.output).toContain('draft changed during approval')
  expect(fetch).not.toHaveBeenCalled()
})

test('test runner uses node --test and caps oversized output', async () => {
  const spawn = jest.fn(() => fakeChild('x'.repeat(100)))
  const run = await runDraftTests(draftDir, { spawn, timeoutMs: 50, maxBytes: 32 })
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    ['--test'],
    expect.objectContaining({ cwd: draftDir, shell: false }),
  )
  expect(run.output.length).toBeLessThanOrEqual(32)
  expect(run.truncated).toBe(true)
})
```

Additional cases: read-only operations make no approval call; each code/mutation operation invokes `ctx.ask` exactly once (no second agent-level prompt); denial/cancel makes no HTTP call; `applyPending` is rejected; missing draft/package names return actionable errors; install with no request id sends no request id; a new iteration can use a new id; check uses `/api/plugins/check`; enable/disable/remove/reload use the existing routes; test failure returns `isError` but does not install; a fake child that never exits is killed at the timeout and returns `timedOut: true`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx jest tests/plugin-creator-tools.test.ts --runInBand`
Expected: FAIL because the manager tool does not exist.

- [ ] **Step 3: Implement draft resolution, fingerprint, test runner, and operations**

Draft resolution:

```ts
const root = path.resolve(projectDir, '.mafw', 'plugin-drafts')
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(draft)) throw new Error('invalid draft')
const candidate = path.resolve(root, draft)
if (!isContained(root, candidate)) throw new Error('invalid draft')
if (!fs.realpathSync(candidate).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('invalid draft')
```

Read `plugin.json` and require `manifest.name === draft`; mismatch returns `plugin.json name must equal draft directory`. Use that name in approval patterns and installation payload.

Draft preparation must reject `.git`, `node_modules`, temp/OS droppings (`.tmp`, `.swp`, `.swo`, `*~`, `.DS_Store`, `Thumbs.db`, `desktop.ini`), symlinks, and non-file/non-directory entries before approval or HTTP. The accepted fingerprint set must equal what `PackageManager` copies; do not silently exclude install-only paths.

Approval order for `check`/`test`/`install`:

1. resolve draft and read files;
2. compute fingerprint;
3. build approval patterns containing operation, draft, package name, overwrite (install only), fingerprint prefix;
4. await `approveCreatorOperation`;
5. recompute fingerprint; mismatch → error `draft changed during approval`;
6. call the REST endpoint or test runner.

HTTP mapping:

- `list`/`status`: `GET /api/plugins`, locally filter exact package when `packageName` is supplied.
- `descriptor`: `GET /api/plugins/client`, locally filter exact package.
- `check`: `POST /api/plugins/check { path }`.
- `install`: `POST /api/plugins/packages/install { path, overwrite?, requestId? }`; include `requestId` only when supplied.
- `enable`/`disable`: `POST /api/plugins/enable|disable { package: packageName }`.
- `remove`: `POST /api/plugins/delete { package: packageName }`.
- `reload`: `POST /api/plugins/<encodeURIComponent(packageName)>/reload`.
- `test`: run the fixed local runner.

`runDraftTests` uses `process.execPath`, args `['--test']`, `shell: false`, cwd draft, and env containing only `PATH`, `Path`, `SystemRoot`, `WINDIR`, `HOME`, `USERPROFILE`, `TMP`, `TEMP`, `NODE_ENV=test`, plus locale variables. Kill the whole process tree on timeout (Windows `taskkill /F /T`; POSIX spawn `detached: true` and kill the negative PID/process group before the direct child) and cap combined stdout/stderr including partial chunks.

The tool result title and `metadata` include `operation`, package name, application state, revision, and `truncated` when relevant. Never return full test output beyond the cap; write the full log to `<project>/.mafw/plugin-drafts/.logs/<draft>.log` and return that path. `.logs` is outside every package directory and cannot be a valid draft name.

Register `mafw_plugin_manager` in `V1_TOOLS`; the plugin registration test goes from 21 to 22 tools.

- [ ] **Step 4: Run focused tests, plugin tests, and build**

Run:
- `npx jest tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts --runInBand`
- `npm run build`

Expected: PASS; build exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/tools/plugin-draft.ts src/tools/plugin-test-runner.ts src/tools/plugin-manager.ts src/plugin.ts tests/plugin-creator-tools.test.ts tests/plugin-v2.test.ts
git commit -m "feat(plugins): add approved creator manager tool"
```

---

### Task 5: Desktop Creator Entry

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pages/creator-entry.ts`
- Create: `packages/desktop/src/renderer/mafw/pages/creator-entry.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
- Produces: `creatorEntryState({ agentsLoaded, hasCreator, isWorktree }): { available: boolean; reason?: 'loading'|'no-agent'|'worktree' }`.
- Produces: `reusableCreatorSession({ activeSessionID, messagesBySession, pageState }): string | null`; only the active Session with a completed page load (`loading === false`, `cursor === null`, `hasMore === false`) and an empty message array is reusable.
- Consumes: existing `createSession`, `applyAgentSwitch`, `openSessionTab`, `activeSessionId`, `primaryAgents`, `agentsData`, `currentProject`, `benchRoot`, `store.message`.
- Produces: new Config prop `onCreatePlugin?: () => void` and PluginPackagesSection prop `creatorEntry?: { available; reason?; onCreate }`.

- [ ] **Step 1: Write failing pure entry tests**

```ts
expect(creatorEntryState({ agentsLoaded: false, hasCreator: false, isWorktree: false }))
  .toEqual({ available: false, reason: 'loading' })
expect(creatorEntryState({ agentsLoaded: true, hasCreator: false, isWorktree: false }))
  .toEqual({ available: false, reason: 'no-agent' })
expect(creatorEntryState({ agentsLoaded: true, hasCreator: true, isWorktree: true }))
  .toEqual({ available: false, reason: 'worktree' })
expect(reusableCreatorSession({
  activeSessionID: 's1',
  messagesBySession: { s1: [] },
  pageState: { s1: { cursor: null, hasMore: false, loading: false } },
})).toBe('s1')
expect(reusableCreatorSession({
  activeSessionID: 's1',
  messagesBySession: { s1: [{}] },
  pageState: { s1: { cursor: null, hasMore: false, loading: false } },
})).toBeNull()
expect(reusableCreatorSession({
  activeSessionID: 's1',
  messagesBySession: { s1: [] },
  pageState: {},
})).toBeNull()
```

- [ ] **Step 2: Run test to verify failure**

Run in `packages/desktop`: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/creator-entry.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the entry and Session switching**

Add a “让 Agent 创建插件” button next to “安装本地目录”. It is disabled with a neutral inline reason while agents load, when `mafw-create` is absent, or in a worktree.

`MafwShell` derives:

```ts
const creatorAgent = primaryAgents().find((a) => isAgentKey(a, 'mafw-create'))
const entry = creatorEntryState({
  agentsLoaded: agentsData().length > 0,
  hasCreator: !!creatorAgent,
  isWorktree: benchRoot() !== currentProject(),
})
```

Handler:

1. verify `entry.available`;
2. reuse the active blank Session when `reusableCreatorSession` returns one, otherwise call `createSession({ noReveal: true, requirePersisted: true })`;
3. if persisted creation fails, show a toast and do not open a `local-` Session;
4. call `applyAgentSwitch(creatorAgent, sid)`;
5. close Config and open the Session tab;
6. send no message and do not change `agentPicks` for any other Session.

Extend `createSession` with `requirePersisted?: boolean`; when true, show a failure toast and return `""` instead of the `local-<ts>` fallback, so existing callers' `if (sid)` checks stay safe and no fake Session is opened. Do not alter the normal new-Session default or the welcome-page path.

Pass the callback from `MafwShell` → `ConfigPage` → `PluginPackagesSection`. Keep the existing `components/session-drafts.ts` behavior unchanged; do not add a Creator-specific composer store.

- [ ] **Step 4: Run focused test, Desktop typecheck, and build**

Run in `packages/desktop`:
- `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/creator-entry.test.ts src/renderer/mafw/components/session-drafts.test.ts`
- `npx tsgo --noEmit -p tsconfig.json`
- `npx electron-vite build`

Expected: PASS; both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/creator-entry.ts packages/desktop/src/renderer/mafw/pages/creator-entry.test.ts packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): enter creator from plugins"
```

---

### Task 6: Deterministic Creator Flow Integration

**Files:**
- Create: `gateway/tests/integration/plugin-creator-flow.test.ts`
- Reuse patterns from: `gateway/tests/integration/plugin-package-e2e.test.ts`
- Create fixtures under: `gateway/tests/fixtures/plugin-creator/`

**Interfaces:**
- Consumes: Phase 1 `PluginHost`, `PackageManager`, temp plugin/state roots.
- Produces: a deterministic fixture package with `plugin.json`, `index.js`, and one `*.test.js` file.

- [ ] **Step 1: Write failing integration test**

Test flow:

1. copy fixture into `<tmp-project>/.mafw/plugin-drafts/acme`;
2. `manager.installFromPath({ path: draft, requestId: 'creator-install-1' })` and capture revision 1;
3. assert the draft still exists and active package name is `acme`;
4. edit the draft title/UI text;
5. `manager.installFromPath({ path: draft, overwrite: true, requestId: 'creator-install-2' })` and assert revision 2 differs;
6. run `manager.checkPath(draft)` after corrupting `index.js`; assert `ok:false` while the active revision stays 2;
7. `manager.remove('acme')`; assert installed directory is gone and the source draft remains;
8. assert no `creator-session`/draft kv file was created by the flow.

Also assert two installs with the same request id replay the first result (existing Manager semantics) while a new iteration with a new request id can advance the revision.

- [ ] **Step 2: Run test to verify failure**

Run in `gateway`: `npx jest --runInBand tests/integration/plugin-creator-flow.test.ts`
Expected: FAIL until the fixture and helper wiring exist.

- [ ] **Step 3: Implement only fixture/helper wiring**

Do not add production features. Use the existing manager/host setup from `plugin-package-e2e.test.ts`; isolate every temp root and clean up in `afterEach`. The fixture package must be a valid Phase 1 package and its test file must pass under `node --test`.

If the flow exposes a production defect, write the focused failing test in the owning task/module before fixing it and do not hide it in this integration test.

- [ ] **Step 4: Run integration and plugin suites**

Run in `gateway`:
- `npx jest --runInBand tests/integration/plugin-creator-flow.test.ts`
- `npx jest --runInBand tests/unit/plugins tests/unit/routes/plugin-packages.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/plugin-creator-flow.test.ts gateway/tests/fixtures/plugin-creator
git commit -m "test(plugins): cover creator draft lifecycle"
```

---

### Task 7: Full Verification, Live Smoke, and Guide

**Files:**
- Create: `docs/guides/plugin-creator.md`
- Modify: `docs/guides/plugin-authoring.md` (link to Creator guide; keep Phase 1 manual flow documented)
- No production files unless the smoke finds a defect; fix test-first.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: guide with entry, exact draft path, permissions/approvals, test command, install/overwrite, pending behavior, failure recovery, draft retention, worktree limitation, and trust boundary.

- [ ] **Step 1: Run deterministic full verification**

Run:
- `npm test --prefix gateway -- --runInBand --forceExit`
- `npm run test:creator`
- `npm test -w @mafw/sdk`
- `npm test -w @mafw/desktop`
- `npx tsc --noEmit` in `gateway`
- `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` in `packages/desktop`
- `npm run build` at repo root
- contract/OpenAPI freshness checks required by the repository

Expected: all pass; record exact new-test and total counts.

- [ ] **Step 2: Run the real-model + real-Desktop smoke**

Before starting, ensure the gateway is reachable only through the intended trust boundary (the pre-existing auth-order P0 is fixed or the gateway is loopback-only). Restart the agent process so the rebuilt plugin tools load.

Open Plugins → “让 Agent 创建插件”. Verify:

1. entry opens a normal Session with `mafw-create` and sends no message;
2. another Session's unsent composer text is still present;
3. the normal new-Session default is unchanged;
4. the model calls `mafw_plugin_inspect` before writing;
5. files appear only under `<project>/.mafw/plugin-drafts/<packageName>/`;
6. denied `check`/`install` executes nothing and mutates nothing;
7. approved install activates panel/config/toolCard/messageWindow without a Desktop restart;
8. a second edit produces a new revision and no stale view;
9. a broken candidate keeps the prior active revision;
10. an active-runtime package remains pending until the user applies it in the Plugins page;
11. restart keeps the draft and installed/pending state; another Creator Session can continue the same folder;
12. remove cleans active contributions but retains the source draft;
13. the worktree entry is disabled.

Record the actual provider/model and commit hash used for the smoke. “No model available” is an explicit skip, not a passing smoke.

- [ ] **Step 3: Document setup, approvals, recovery, and limitations**

Write `docs/guides/plugin-creator.md` with concrete commands and paths. State explicitly:

- native approval `always` does not persist a grant;
- `check`/`test` run trusted draft code, not a sandbox;
- no model-visible `applyPending`;
- no visual screenshot feedback; user reports rendering issues;
- drafts are not auto-deleted;
- worktree Creator entry is disabled;
- source is project files; installed package is a copy.

- [ ] **Step 4: Fix smoke defects test-first and rerun full verification**

Write a failing regression test before each fix, then rerun the complete Step 1 suite. Report both the deterministic result and the live-smoke result separately.

- [ ] **Step 5: Commit**

```bash
git add docs/guides/plugin-creator.md docs/guides/plugin-authoring.md <smoke-fix-files>
git commit -m "docs(plugins): document agent create workflow"
```

---

## Self-Review Checklist

- Spec §15.1 ordinary blank Session: Task 5.
- §15.2 identity, skill, tool boundary: Task 1.
- §15.3 read-only inspection: Task 2.
- §15.4 project drafts, no session binding, worktree limitation: Tasks 4–6.
- §15.5 native approval, fixed test, operations, fingerprint, request id: Tasks 3–4.
- §15.6 flow and trusted-code verification: Tasks 4, 6, 7.
- §15.7 Desktop reuse with no new Creator API: Task 5.
- §15.8 acceptance 1–8: Tasks 3–6; acceptance 9: Task 7.
- No task creates a dedicated Creator Session, gateway draft kv, or a second install path.
