# Kernel v2 Phase 5 / Automation Live Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 automation 的 action provider 接进 live `AutomationEngine`，并让插件事件可以触发 automation rule；cron、cooldown、去重、budget、scheduler 仍由 core 拥有。

**Architecture:** `AutomationEngine` 增加一个外部 action resolver（本地 `actions` map 优先），插件 action 以 `plugin:<pkg>:<action>` 命名。`PluginEventRegistry` 增加一个 fail-open 的 `onEvent` sink，`PluginHost` 透传；kernel 把包事件交给 `AutomationEngine.handleExternalEvent()`，按 `rule.trigger.on` 匹配。Timer / CronJob / eventBus / cooldown / stateVersion / budget 不移交。

**Tech Stack:** TypeScript / Node、Jest、现有 `AutomationEngine`、`PluginHost` / `PluginActionRegistry` / `PluginEventRegistry`。

**Spec:** `docs/research/2026-11-13-phase5-remaining-scope.md`、`docs/research/2026-11-13-phase5-stateful-capabilities-review.md`

## Global Constraints

- 不把 cron / timer / scheduler 所有权交给 provider；`AutomationEngine` 仍是唯一调度者。
- action 解析顺序：本地 `actions` map → external resolver；local 永远优先。
- 插件 action 失败只能影响该 rule：`missing` / `error` 返回状态，不抛进 scheduler 主循环。
- 插件事件 sink 必须 fail-open：sink 抛错不能阻止 SSE/WS broadcast，也不能让 `ctx.emit` 失败。
- 事件去重：goal 事件沿用 `goalId + stateVersion`；非 goal 插件事件用 `sessionID` / `global` 作用域 + `perGoalCooldown`，不伪造 stateVersion。
- 不改变现有 automation rule 文件格式；`action.type` 只是可接受新的 `plugin:` 形式。
- 不引入第三方包 loader；只接已安装的统一插件包 action/event。

## Review Focus

1. **Local action 优先**：同名 `plugin:` 与本地 action 同时存在时，本地 handler 必须胜出。
2. **插件 action 不存在**：rule 校验/执行返回 missing，不抛到 scheduler。
3. **插件 action 抛错**：只把该次执行标为 error，其他 rule 继续。
4. **事件 sink 抛错**：broadcast 仍成功，`ctx.emit` 仍返回 ok。
5. **插件事件风暴**：`perGoalCooldown` 必须生效；非 goal 事件不能因 stateVersion=0 被永久去重。
6. **reload/remove**：包卸载或 rule reload 后，旧事件/旧 action 不再触发。

---

## File Structure

**Create:**
- `gateway/src/plugins/automation-actions.ts` — `plugin:<pkg>:<action>` 解析 + 外部 action resolver。
- `gateway/tests/unit/automation-engine-external-actions.test.ts`
- `gateway/tests/unit/automation-engine-external-events.test.ts`
- `gateway/tests/unit/plugins/automation-actions.test.ts`

**Modify:**
- `gateway/src/automation-engine.ts` — external action resolver、`handleExternalEvent`、event rule 重构、rule validation。
- `gateway/src/plugins/plugin-events.ts` — `onEvent` sink + diagnostic。
- `gateway/src/plugins/package-host.ts` — `PluginHostOptions.onEvent` 透传。
- `gateway/src/kernel.ts` — `bindPluginAutomation()` / `handlePluginEvent()`。
- `gateway/src/boot.ts` — 创建 `PluginHost` 时接 `onEvent`，并绑定 action resolver。
- `gateway/tests/unit/plugins/plugin-events.test.ts` — sink 行为。
- `docs/releases/2026-11-13-capability-kernel-phase5-automation.md` — 交付记录。
- `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md` — Phase 5 状态。

---

### Task 1: Automation external action resolver

**Files:**
- Modify: `gateway/src/automation-engine.ts`
- Test: `gateway/tests/unit/automation-engine-external-actions.test.ts`

**Interfaces:**
- Consumes: `AutomationRule`, `RegisteredAction`, `ActionHandler`.
- Produces:

```ts
export type ActionSource = 'cron' | 'event' | 'user' | 'llm'

export type ExternalActionHandler = (
  rule: AutomationRule,
  engine: AutomationEngine,
  source?: ActionSource,
) => Promise<void>

export interface ExternalActionEntry {
  handler: ExternalActionHandler
  taskOpts?: RegisteredAction['taskOpts']
}

export type ExternalActionResolver = (type: string) => ExternalActionEntry | undefined

// AutomationEngine
setExternalActionResolver(resolver: ExternalActionResolver | null): void
canResolveAction(type: string): boolean
```

- [ ] **Step 1: Write the failing test**

```ts
import { AutomationEngine } from '../../src/automation-engine'

test('local action wins over the external resolver', async () => {
  const engine = new AutomationEngine(tmpDir())
  const calls: string[] = []
  let externalCalls = 0
  engine.setActionsProvider(() => {
    engine.registerAction('same', async () => { calls.push('local') })
  })
  engine.setExternalActionResolver(() => ({
    handler: async () => { externalCalls++; calls.push('external') },
  }))
  engine.start()
  await (engine as any).executeAction('same', { id: 'r1', enabled: true, trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' }, action: { type: 'same' } }, 'user')
  expect(calls).toEqual(['local'])
  expect(externalCalls).toBe(0)
})

test('external action runs when no local handler exists', async () => {
  const engine = new AutomationEngine(tmpDir())
  const seen: unknown[] = []
  engine.setExternalActionResolver((type) => type === 'plugin:p:a'
    ? { handler: async (rule) => { seen.push(rule.id) } }
    : undefined)
  await (engine as any).executeAction('plugin:p:a', { id: 'r1', enabled: true, trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' }, action: { type: 'plugin:p:a' } }, 'event')
  expect(seen).toEqual(['r1'])
})

test('missing external action returns missing and throwing external returns error', async () => {
  const engine = new AutomationEngine(tmpDir())
  expect(await (engine as any).executeAction('missing', { id: 'r1' } as any, 'cron')).toBe('missing')
  engine.setExternalActionResolver(() => ({ handler: async () => { throw new Error('boom') } }))
  expect(await (engine as any).executeAction('boom', { id: 'r1' } as any, 'cron')).toBe('error')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/automation-engine-external-actions.test.ts`
Expected: FAIL — `setExternalActionResolver` is not a function.

- [ ] **Step 3: Implement the resolver**

- Add `ActionSource`, `ExternalActionHandler`, `ExternalActionEntry`, `ExternalActionResolver`.
- `AutomationEngine` stores `externalActionResolver`; `setExternalActionResolver` assigns/clears.
- `canResolveAction(type)` returns `this.actions.has(type) || Boolean(this.externalActionResolver?.(type))`.
- `validateRule` uses `canResolveAction` instead of `hasAction`.
- `executeAction`:
  - local entry first;
  - external entry if no local;
  - no entry → `'missing'`;
  - no scheduler → `await handler(rule, this, source)`;
  - scheduler callback `() => handler(rule, this, source)`.
- Keep `ActionHandler` backward compatible by adding optional third `source` parameter.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/automation-engine-external-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/automation-engine.ts gateway/tests/unit/automation-engine-external-actions.test.ts
git commit -m "feat(automation): add external action resolver"
```

---

### Task 2: Plugin action adapter + live binding

**Files:**
- Create: `gateway/src/plugins/automation-actions.ts`
- Test: `gateway/tests/unit/plugins/automation-actions.test.ts`
- Modify: `gateway/src/kernel.ts`
- Modify: `gateway/src/boot.ts`

**Interfaces:**
- Consumes: `PluginActionRegistry.has(pkg, action)`, `PluginHost.invokeAction`.
- Produces:

```ts
export interface PluginAutomationActionDeps {
  has: (packageName: string, action: string) => boolean
  invoke: (packageName: string, action: string, input: unknown) => Promise<unknown>
}

export function pluginAutomationActionType(packageName: string, action: string): string

export function createPluginAutomationActionResolver(
  deps: PluginAutomationActionDeps,
): ExternalActionResolver
```

- [ ] **Step 1: Write the failing test**

```ts
import { pluginAutomationActionType, createPluginAutomationActionResolver } from '../../../src/plugins/automation-actions'

test('maps plugin actions to the namespaced type and passes rule metadata', async () => {
  const calls: unknown[] = []
  const resolver = createPluginAutomationActionResolver({
    has: (pkg, action) => pkg === 'demo' && action === 'refresh',
    invoke: async (pkg, action, input) => { calls.push([pkg, action, input]) },
  })
  const entry = resolver(pluginAutomationActionType('demo', 'refresh'))
  expect(entry).toBeTruthy()
  await entry!.handler({ id: 'r1', args: { region: 'cn' } } as any, {} as any, 'event')
  expect(calls).toEqual([['demo', 'refresh', { region: 'cn', ruleId: 'r1', source: 'event' }]])
})

test('unknown packages/actions do not resolve', () => {
  const resolver = createPluginAutomationActionResolver({ has: () => false, invoke: async () => null })
  expect(resolver('plugin:demo:refresh')).toBeUndefined()
  expect(resolver('demo:refresh')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/automation-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement adapter + kernel binding**

- `pluginAutomationActionType` returns `plugin:<pkg>:<action>`; parse with the same strict pattern.
- Resolver only resolves `plugin:` types whose `has(pkg, action)` is true.
- Handler input: `{ ...(rule.args ?? {}), ruleId: rule.id, source }` (metadata wins over args).
- `MafwScheduler` add:
  ```ts
  bindPluginAutomation(host: PluginHost): void
  handlePluginEvent(event: PluginEventFrame): void
  ```
  `bindPluginAutomation` sets the external resolver from `host.getActionRegistry().has` + `host.invokeAction`.
- In `boot.ts` after `new PluginHost(...)`: call `kernel.bindPluginAutomation(kernel.pluginHost)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/automation-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/automation-actions.ts gateway/tests/unit/plugins/automation-actions.test.ts gateway/src/kernel.ts gateway/src/boot.ts
git commit -m "feat(automation): resolve plugin actions in live rules"
```

---

### Task 3: Plugin event sink

**Files:**
- Modify: `gateway/src/plugins/plugin-events.ts`
- Modify: `gateway/src/plugins/package-host.ts`
- Test: `gateway/tests/unit/plugins/plugin-events.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PluginEventRegistryOptions {
  // existing...
  /** Optional secondary sink (automation bridge); fail-open. */
  onEvent?: (event: PluginEventFrame) => void
}

export interface PluginHostOptions {
  // existing...
  onEvent?: (event: PluginEventFrame) => void
}
```

- [ ] **Step 1: Write the failing test**

```ts
test('onEvent receives a validated frame and a throwing sink does not block broadcast', () => {
  const broadcasts: any[] = []
  const events: any[] = []
  const registry = new PluginEventRegistry({
    broadcast: (frame) => broadcasts.push(frame),
    onEvent: (frame) => { events.push(frame); throw new Error('sink down') },
  })
  // register a package event + emit exactly as the existing tests do
  // ...
  expect(broadcasts).toHaveLength(1)
  expect(events).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-events.test.ts`
Expected: FAIL — `onEvent` not called.

- [ ] **Step 3: Implement the sink**

- Add `onEvent` option and field.
- In `emit()` after validation, before/after broadcast:
  ```ts
  try { this.onEvent?.(frame) } catch (err) { this.record({ packageName, type, code: 'sink-failed', message: ... }) }
  ```
- Add `'sink-failed'` to `PluginEventDiagnosticCode`.
- `PluginHostOptions.onEvent` passed to `PluginEventRegistry` constructor.
- `PluginHost` constructor already passes `broadcast`; add `onEvent`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-events.ts gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/plugin-events.test.ts
git commit -m "feat(plugins): add fail-open event sink"
```

---

### Task 4: Automation external event bridge

**Files:**
- Modify: `gateway/src/automation-engine.ts`
- Test: `gateway/tests/unit/automation-engine-external-events.test.ts`

**Interfaces:**
- Produces:

```ts
handleExternalEvent(event: {
  type: string
  properties?: Record<string, unknown>
  sessionID?: string
}): void
```

- [ ] **Step 1: Write the failing test**

```ts
test('a plugin event triggers matching event rules with cooldown', async () => {
  const dir = tmpDir()
  writeRule(dir, {
    id: 'r1',
    enabled: true,
    trigger: { type: 'event', on: ['plugin:demo:changed'], perGoalCooldown: '1h' },
    action: { type: 'test' },
  })
  const engine = new AutomationEngine(dir)
  let runs = 0
  engine.setActionsProvider(() => engine.registerAction('test', async () => { runs++ }))
  engine.start()
  engine.handleExternalEvent({ type: 'plugin:demo:changed', sessionID: 's1', properties: { value: 1 } })
  engine.handleExternalEvent({ type: 'plugin:demo:changed', sessionID: 's1', properties: { value: 2 } })
  await new Promise((r) => setTimeout(r, 20))
  expect(runs).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/automation-engine-external-events.test.ts`
Expected: FAIL — `handleExternalEvent` is not a function.

- [ ] **Step 3: Implement external events**

- Refactor `fireEventRule(rule, scopeId, dedupeKey?)`:
  - cooldown key `${rule.id}:${scopeId}`;
  - only apply `reportedPairs` when `dedupeKey` is provided.
- Existing `eventBus` handler uses `goalId` + `goal:${stateVersion}`.
- `handleExternalEvent`:
  - for each enabled event rule whose `trigger.on.includes(event.type)`;
  - `goalId` from `properties.goalId` if string;
  - `scopeId = goalId ?? event.sessionID ?? 'external'`;
  - `dedupeKey = goalId ? `goal:${stateVersion}` : undefined`;
  - `fireEventRule(rule, scopeId, dedupeKey)`;
  - catch per rule and log, never throw.
- `scheduleEventRule` skips `eventBus.on` for `plugin:` event names; still records them in `eventListeners` for diagnostics. `eventHandlerRefs` only stores non-plugin listeners.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/automation-engine-external-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/automation-engine.ts gateway/tests/unit/automation-engine-external-events.test.ts
git commit -m "feat(automation): trigger rules from plugin events"
```

---

### Task 5: Live wiring + rule validation + docs

**Files:**
- Modify: `gateway/src/boot.ts`
- Modify: `gateway/src/kernel.ts`
- Modify: `gateway/src/automation-engine.ts` (`validateRule` already uses `canResolveAction`)
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- Create: `docs/releases/2026-11-13-capability-kernel-phase5-automation.md`

- [ ] **Step 1: Wire PluginHost event sink**

In `boot.ts`, pass:
```ts
onEvent: (event) => kernel.handlePluginEvent(event)
```
and after the host is created:
```ts
kernel.bindPluginAutomation(kernel.pluginHost)
```

- [ ] **Step 2: Test the live wiring source pins**

Add/extend `gateway/tests/unit/plugins/automation-actions.test.ts` or an architecture test:
- `kernel.ts` contains `bindPluginAutomation`;
- `boot.ts` contains `onEvent:`;
- `kernel.ts` contains `handlePluginEvent`.

- [ ] **Step 3: Run the full gate**

```bash
cd gateway
npx jest --runInBand --forceExit
npx tsc --noEmit -p tsconfig.json
```

Expected: full green; typecheck 0.

- [ ] **Step 4: Write release note + roadmap**

- Scope: external action resolver, plugin action adapter, plugin event sink, external event bridge.
- Non-goals: no timer-owning trigger provider; no cron migration; no new node/scheduler ownership.
- Tests: new count + full suite counts.
- Rollback: remove resolver/bridge; rules with `plugin:` action become `missing`; plugin events no longer trigger.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/boot.ts gateway/src/kernel.ts gateway/tests/unit/plugins/automation-actions.test.ts docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md docs/releases/2026-11-13-capability-kernel-phase5-automation.md
git commit -m "docs: record phase 5 automation live wiring"
```

---

## Self-Review

- **Spec coverage:** action live wiring, plugin action namespace, event sink, external event bridge, cooldown, rule validation, docs.
- **Step scan:** each task starts with a failing test and ends with a commit.
- **Type consistency:** `ActionSource`, `ExternalActionResolver`, `pluginAutomationActionType`, `PluginEventRegistryOptions.onEvent`, `AutomationEngine.handleExternalEvent` keep the same names across tasks.
- **Review Focus:** local precedence, missing/throwing action, sink failure, event storm, reload/remove are covered by tests or explicit behavior.
- **Proportion:** plan defines interfaces and test assertions; no full implementation bodies.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-11-13-kernel-v2-phase5-automation.md`. Please review. Native execution recommended: the tasks share the same small engine/plugin surface and can be implemented sequentially in this session.
