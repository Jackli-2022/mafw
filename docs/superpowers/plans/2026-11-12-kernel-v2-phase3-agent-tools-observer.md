# Kernel v2 Phase 3 Agent Tools + Event Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件通过 kernel-v2 贡献 agent tools，并让只读 canonical event observer 以 fail-open、可过滤、不阻塞主链的方式订阅事件；先用 S5 probe 证明 observer 的隔离与超时语义。

**Architecture:** 延续路线 B：Phase 3 的注册表、工具适配、observer 全部落在 `gateway/src/kernel-v2/`，不接 live gateway 默认路径。工具通过现有 `RuntimeTools.registerTools(factory)` 的 `MafwToolRegistration` 形状交付；observer 只在 canonical 事件归一化后接收只读快照。G3 用 fake runtime + canonical dispatch harness 证明闭环；live 接线留到 Phase 3.5/cutover，避免 v1 行为变化。

**Tech Stack:** TypeScript / Node、Jest（gateway）、`@mafw/plugin-contract`、现有 `MafwToolRegistration` / `EventFacets` / `PluginGatewayContributes` 类型。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

**Roadmap:** `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`

## Progress（2026-11-12）

- Milestone 3A–3C 全部完成（conformance harness 级 G3）。
- 定向门禁：kernel-v2 + architecture + G3 + G2 + shadow **178 / 178 pass**（Phase 2 基线 146 → 178，新增 32）。
- plugin-contract：**40 / 40 pass**（+2）。
- gateway 全量：**6962 passed / 1 skipped / 6963 total**，连续两次 clean；基线含其他会话的 E5a 测试。
- typecheck（gateway + plugin-contract）：通过。
- 交付记录：`docs/releases/2026-11-12-capability-kernel-phase3.md`。
- S5 结论：`docs/research/2026-11-12-s5-canonical-event-observer-probe.md`。
- 明确未做：live event-dispatch / RuntimeTools 接线、interceptor、worker 隔离。

## Global Constraints

- 路线 B：Phase 3 仍只在 `gateway/src/kernel-v2/` 与独立测试中实现，**不接 live gateway 默认路径、不碰 `~/.mafw` 数据**。
- v1 路径是 fallback：不改 `gateway/src/kernel.ts`、`boot.ts`、`http/transport.ts`、`runtime/event-dispatch.ts`、`runtime/mafw-tools.ts` 的现有行为。
- 核心不变量不可替换：人类验收/审批/权限/审计、记忆 soft supersede / T1 / 100ms recall、canonical 事件顺序、DB 迁移、`planHash`/`evalHash`、desktop preload/webview sandbox、runtime 四条。
- 人类验收继续要求 human/device 凭据（`human_principal_required`）；observer/tool 永远不能绕过或代签。
- **Observer 是只读、post-hoc、fail-open；不是 interceptor。** 超时/异常只丢观察结果，不影响主链、SSE、recall 或 turn 生命周期。
- Tool handler 抛错/超时只返回 tool error，不拖垮 turn；tool 结果不回流 T1。
- `untrusted` provider 在 Phase 6 worker 隔离前 **fail-closed 拒绝**。
- 工具名必须命名空间化：`plugin:<package>:<tool>`；包内名字不得含 `:`。
- 所有生产代码先写失败测试，再实现；每个 task 结束提交。
- 全量门禁：G3 前在 canonical build 上连续 2 次 clean full-suite。

## Review Focus

- **Observer 不阻塞主链**：`dispatch()` 必须同步返回；慢 handler、同步抛错、async reject、超时、队列溢出都不能让调用方等待或抛错。
- **Observer 作用域**：session/project/type 过滤器必须准确；一个会话的 observer 不得收到其他会话的事件。
- **Tool 失败隔离**：handler 抛错、超时、health failed、非法输入都只产生 `isError: true` 的 tool 结果，不抛到 runtime。
- **Tool 作用域**：session-scoped tool 只对注册会话可见；global tool 对所有会话可见；重注册替换旧版本，不泄漏旧 handler。
- **Observer 看不到 secret**：事件快照不得包含 prompt、API key、token；只保留 type/sessionID/projectId/at 与调用方显式挂载的 properties。
- **人类验收不可绕过**：tool/observer 不能调用 accept，也不能伪造 human principal；相关路由 403 语义不变。

---

## File Structure

```text
gateway/src/kernel-v2/
  observer.ts                # 新增：CanonicalObserverRegistry（filter/timeout/queue/diagnostics）
  tools.ts                   # 新增：ToolContributionRegistry + MafwToolRegistration 适配
  canonical-event.ts         # 新增：EventFacets → CanonicalEvent 只读快照
gateway/tests/helpers/kernel-v2/
  observer-conformance.ts    # 新增：observer conformance kit
  tools-conformance.ts       # 新增：tools conformance kit
gateway/tests/fixtures/kernel-v2/
  plugin-tool-echo.ts        # 新增：测试包 tool contribution
  observer-recorder.ts       # 新增：测试 observer
gateway/tests/unit/kernel-v2/
  observer.test.ts           # 新增：S5 probe 单元测试
  observer-conformance.test.ts
  tools.test.ts
  tools-conformance.test.ts
gateway/tests/integration/
  kernel-v2-g3.test.ts       # 新增：fake runtime + observer 闭环
packages/plugin-contract/src/
  types.ts                   # 修改：PluginGatewayContributes.tools + PluginToolDescriptor
  validate.ts                # 修改：tools 声明校验
  validate.test.ts           # 修改：新增 tools 用例
docs/research/
  2026-11-12-s5-canonical-event-observer-probe.md  # 新增：S5 结论
docs/releases/
  2026-11-12-capability-kernel-phase3.md           # 新增：交付记录
```

---

## Milestone 3A：S5 canonical event observer probe

### Task 3.1：CanonicalObserverRegistry

**Files:**
- Create: `gateway/src/kernel-v2/observer.ts`
- Test: `gateway/tests/unit/kernel-v2/observer.test.ts`

**Interfaces:**
```ts
export interface CanonicalEvent {
  type: string;
  sessionID?: string;
  projectId?: string;
  at: number;
  properties?: Record<string, unknown>;
}

export interface ObserverFilter {
  sessionID?: string;
  projectId?: string;
  /** Exact type or trailing `*` prefix match (e.g. "tool.*"). */
  types?: string[];
}

export interface CanonicalObserver {
  id: string;
  filter?: ObserverFilter;
  onEvent(event: CanonicalEvent): void | Promise<void>;
  timeoutMs?: number;
  dispose?(): void | Promise<void>;
}

export interface ObserverDiagnostic {
  observerId: string;
  delivered: number;
  failed: number;
  timedOut: number;
  lastError?: string;
}

export interface ObserverRegistryOptions {
  defaultTimeoutMs?: number;
  /** Max queued (observer, event) pairs; overflow drops the newest. */
  maxQueue?: number;
  onError?: (info: { observerId: string; error: string; kind: 'throw' | 'timeout' | 'overflow' }) => void;
}

export class CanonicalObserverRegistry {
  register(observer: CanonicalObserver): () => void;
  dispatch(event: CanonicalEvent): void;
  drain(): Promise<void>;
  diagnostics(): ObserverDiagnostic[];
  dropped(): number;
  dispose(): Promise<void>;
}
```

语义：

1. `dispatch()` 只做过滤 + 入队 + `setImmediate` 调度，**同步返回**。
2. `maxQueue` 默认 1000；溢出丢最新并计数，`onError({kind:'overflow'})`。
3. 每个 observer 的 handler 用 `Promise.race` 加超时（默认 1000ms）。超时记录 `timedOut`，不取消已运行的 handler（Phase 6 worker 才可真正取消）。
4. 同步 throw / async reject 记录 `failed`，继续其他 observer。
5. `drain()` 等待队列清空和 in-flight 完成，供测试与优雅关闭。
6. `dispose()` 清空队列、退订、逆序调用 observer `dispose`，隔离错误；再次 `dispatch` no-op。
7. `diagnostics()` 返回每个 observer 的 delivered/failed/timedOut/lastError；`dropped()` 返回 total。

- [ ] **Step 1: 写失败测试**

```ts
import { CanonicalObserverRegistry, type CanonicalEvent } from '../../../src/kernel-v2/observer';

const event = (over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  type: 'tool.updated',
  sessionID: 's1',
  at: Date.now(),
  properties: { tool: 'x' },
  ...over,
});

describe('CanonicalObserverRegistry', () => {
  test('dispatch is non-blocking and observers receive the event after drain', async () => {
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({ id: 'a', onEvent: (e) => { seen.push(e.type); } });
    const start = Date.now();
    for (let i = 0; i < 1000; i += 1) registry.dispatch(event());
    expect(Date.now() - start).toBeLessThan(100);
    expect(seen).toEqual([]);
    await registry.drain();
    expect(seen).toHaveLength(1000);
  });

  test('filters by session, project and exact/prefix type', async () => {
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({ id: 'a', filter: { sessionID: 's1', types: ['tool.*'] }, onEvent: (e) => { seen.push(e.type); } });
    registry.dispatch(event({ sessionID: 's2', type: 'tool.updated' }));
    registry.dispatch(event({ type: 'message.updated' }));
    registry.dispatch(event({ type: 'tool.completed' }));
    await registry.drain();
    expect(seen).toEqual(['tool.completed']);
  });

  test('a throwing observer does not block another observer', async () => {
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({ id: 'bad', onEvent: () => { throw new Error('boom'); } });
    registry.register({ id: 'good', onEvent: () => { seen.push('good'); } });
    registry.dispatch(event());
    await registry.drain();
    expect(seen).toEqual(['good']);
    expect(registry.diagnostics().find((d) => d.observerId === 'bad')?.failed).toBe(1);
  });

  test('a rejecting observer is isolated', async () => {
    const registry = new CanonicalObserverRegistry();
    registry.register({ id: 'bad', onEvent: async () => { throw new Error('nope'); } });
    registry.dispatch(event());
    await registry.drain();
    expect(registry.diagnostics()[0]).toMatchObject({ observerId: 'bad', failed: 1, lastError: 'nope' });
  });

  test('a slow observer times out without blocking drain forever', async () => {
    const registry = new CanonicalObserverRegistry({ defaultTimeoutMs: 20 });
    registry.register({ id: 'slow', onEvent: () => new Promise<void>(() => {}) });
    registry.dispatch(event());
    await expect(registry.drain()).resolves.toBeUndefined();
    expect(registry.diagnostics()[0]).toMatchObject({ observerId: 'slow', timedOut: 1 });
  });

  test('queue overflow drops the newest and counts it', async () => {
    const registry = new CanonicalObserverRegistry({ maxQueue: 2, defaultTimeoutMs: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seen: number[] = [];
    registry.register({ id: 'a', onEvent: async (e) => { seen.push(e.at); await gate; } });
    registry.dispatch(event({ at: 1 }));
    registry.dispatch(event({ at: 2 }));
    registry.dispatch(event({ at: 3 }));
    expect(registry.dropped()).toBe(1);
    release();
    await registry.drain();
    expect(seen).toEqual([1, 2]);
  });

  test('dispose stops delivery and calls observer dispose once', async () => {
    let disposed = 0;
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({ id: 'a', onEvent: () => { seen.push('x'); }, dispose: () => { disposed += 1; } });
    await registry.dispose();
    registry.dispatch(event());
    await registry.drain();
    expect(seen).toEqual([]);
    expect(disposed).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/observer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `CanonicalObserverRegistry`**

实现要点：内部 `Map<string, CanonicalObserver>`；`dispatch` 过滤后 push 到 `queue`；`schedule` 用 `setImmediate`；`flush` 取一批并 `Promise.all`；`runOne` 用 `Promise.race`；`drain` 用 waiter 列表；`dispose` 清理并逆序 dispose。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/observer.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/observer.ts gateway/tests/unit/kernel-v2/observer.test.ts
git commit -m "feat(kernel-v2): add canonical observer registry (S5)"
```

---

### Task 3.2：Observer conformance kit + S5 报告

**Files:**
- Create: `gateway/tests/helpers/kernel-v2/observer-conformance.ts`
- Create: `gateway/tests/unit/kernel-v2/observer-conformance.test.ts`
- Create: `docs/research/2026-11-12-s5-canonical-event-observer-probe.md`

**Interfaces:**
```ts
export interface ObserverConformanceFactory {
  create(): CanonicalObserverRegistry;
}
export function runObserverConformance(name: string, factory: ObserverConformanceFactory): void;
```

Kit 覆盖：fan-out、过滤、同步 throw、async reject、timeout、queue overflow、dispose。测试用 recorder observer。

- [ ] **Step 1: 写失败测试**

```ts
import { CanonicalObserverRegistry } from '../../../src/kernel-v2/observer';
import { runObserverConformance } from '../../helpers/kernel-v2/observer-conformance';

runObserverConformance('observer', {
  create: () => new CanonicalObserverRegistry({ defaultTimeoutMs: 20, maxQueue: 10 }),
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/observer-conformance.test.ts`
Expected: FAIL — helper not found

- [ ] **Step 3: 实现 kit 与 S5 报告**

报告必须包含：问题、证据（测试数、非阻塞测量）、决策（observer 只读/fail-open、dispatch 同步入队、timeout 不取消、Phase 6 worker 才隔离）、未决（live hook 位置、payload 脱敏范围）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/observer-conformance.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/tests/helpers/kernel-v2/observer-conformance.ts gateway/tests/unit/kernel-v2/observer-conformance.test.ts docs/research/2026-11-12-s5-canonical-event-observer-probe.md
git commit -m "docs: record S5 canonical observer probe"
```

**Milestone 3A gate:** observer 定向测试全绿；dispatch 同步返回；超时/异常/溢出隔离；S5 报告落盘。

---

## Milestone 3B：Plugin tool contribution

### Task 3.3：plugin-contract tools 声明

**Files:**
- Modify: `packages/plugin-contract/src/types.ts`
- Modify: `packages/plugin-contract/src/validate.ts`
- Modify: `packages/plugin-contract/src/validate.test.ts`

**Interfaces:**
```ts
export interface PluginToolDescriptor {
  name: string
  title?: string
  description: string
  inputSchema: PluginJsonSchema
  outputSchema?: PluginJsonSchema
  timeoutMs?: number
  scope?: "global" | "session"
}

export interface PluginGatewayContributes {
  actions?: string[]
  events?: string[]
  tools?: PluginToolDescriptor[]
  http?: boolean
}
```

校验规则：

- `tools` 必须是数组；每项是 object。
- `name` 非空、匹配 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`，不得含 `:`（命名空间由 Host 加）。
- `description` 非空；`inputSchema` 是 object。
- `timeoutMs` 正整数且 ≤ 120000（复用 `PLUGIN_UI_LIMITS` 风格）。
- `scope` 只能是 `global` / `session`。
- 未知字段拒绝；现有 manifest 不含 `tools` 仍通过。

- [ ] **Step 1: 写失败测试**

```ts
test("manifest contributes: accepts gateway tools", () => {
  const result = validatePluginManifestContributes({
    gateway: {
      tools: [{
        name: "echo",
        description: "Echo input",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        scope: "session",
      }],
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.gateway?.tools?.[0].name, "echo");
});

test("manifest contributes: rejects bad tool names and timeouts", () => {
  for (const name of ["", "a:b", "bad name"]) {
    const r = validatePluginManifestContributes({ gateway: { tools: [{ name, description: "x", inputSchema: {} }] } });
    assert.equal(r.ok, false);
  }
  const timeout = validatePluginManifestContributes({ gateway: { tools: [{ name: "ok", description: "x", inputSchema: {}, timeoutMs: 0 }] } });
  assert.equal(timeout.ok, false);
  const scope = validatePluginManifestContributes({ gateway: { tools: [{ name: "ok", description: "x", inputSchema: {}, scope: "global" }] } });
  assert.equal(scope.ok, true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:plugin-contract`
Expected: FAIL — `tools` not accepted / missing type

- [ ] **Step 3: 实现类型与校验**

在 `types.ts` 加 `PluginToolDescriptor`，在 `PluginGatewayContributes` 加 `tools?: PluginToolDescriptor[]`；在 `validate.ts` 的 `validatePluginManifestContributes` 里增加 `GATEWAY_CONTRIBUTES_KEYS` 的 `tools` 分支，复用 `readSlotArray`/`checkKnownFields`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:plugin-contract`
Expected: PASS（现有 38 + 新增 2 = 40 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-contract/src/types.ts packages/plugin-contract/src/validate.ts packages/plugin-contract/src/validate.test.ts
git commit -m "feat(plugin-contract): add gateway tool declarations"
```

---

### Task 3.4：ToolContributionRegistry

**Files:**
- Create: `gateway/src/kernel-v2/tools.ts`
- Test: `gateway/tests/unit/kernel-v2/tools.test.ts`

**Interfaces:**
```ts
import type { MafwToolRegistration } from '../runtime/contract';

export interface ToolExecutionContext {
  sessionID: string;
  signal?: AbortSignal;
}

export interface ToolContribution {
  packageName: string;
  name: string;
  title?: string;
  description: string;
  parameters: Record<string, any>;
  outputSchema?: Record<string, any>;
  timeoutMs?: number;
  scope?: 'global' | 'session';
  /** Required when scope === 'session'. */
  sessionID?: string;
  execute(input: unknown, ctx: ToolExecutionContext): Promise<{ text: string; isError?: boolean }>;
  health?: () => 'healthy' | 'degraded' | 'failed';
  dispose?(): void | Promise<void>;
}

export interface ToolContributionRegistry {
  register(contribution: ToolContribution): () => void;
  list(sessionID?: string): ToolContribution[];
  resolve(name: string, sessionID?: string): ToolContribution | undefined;
  factory(): (sessionID: string) => MafwToolRegistration[];
  invoke(name: string, input: unknown, ctx: ToolExecutionContext): Promise<{ text: string; isError?: boolean }>;
  diagnostics(): Array<{ name: string; packageName: string; scope: string; state: string }>;
  dispose(): Promise<void>;
}

export function createToolContributionRegistry(options?: {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}): ToolContributionRegistry;
```

语义：

1. 注册名 = `plugin:${packageName}:${name}`；packageName/name 必须匹配 `[A-Za-z0-9][A-Za-z0-9._-]*`，name 不得含 `:`。
2. `scope: 'session'` 必须提供 `sessionID`；否则注册抛错。
3. 重复全名：后注册替换前一个；返回的 unregister 只移除“当前版本”，防止旧 revision 的 dispose 误删新版本。
4. `list(sessionID)` 返回 global + 该 session 的 session-scoped 工具，按注册顺序。
5. `factory()` 返回 `(sessionID) => MafwToolRegistration[]`，可直接传给 `RuntimeTools.registerTools`。
6. `invoke()`：
   - 找不到 → `{ text: 'unknown tool: ...', isError: true }`；
   - health failed → `{ text: 'tool unavailable: ...', isError: true }`；
   - 用 `AbortController` + `Promise.race` 施加 timeout（默认 60000，上限 120000）；
   - handler 同步 throw / async reject / timeout → `isError: true`，绝不抛；
   - 成功返回 handler 的 `{text,isError}`。
7. `dispose()` 逆序调用 contribution.dispose，隔离错误。

- [ ] **Step 1: 写失败测试**

```ts
import { createToolContributionRegistry } from '../../../src/kernel-v2/tools';

const tool = (over: Partial<Parameters<ReturnType<typeof createToolContributionRegistry>['register']>[0]> = {}) => ({
  packageName: 'demo',
  name: 'echo',
  description: 'Echo',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  execute: async (input: any) => ({ text: String(input?.text ?? '') }),
  ...over,
});

describe('ToolContributionRegistry', () => {
  test('namespaces tools and exposes a runtime factory', () => {
    const registry = createToolContributionRegistry();
    registry.register(tool());
    const registrations = registry.factory()('s1');
    expect(registrations.map((r) => r.name)).toEqual(['plugin:demo:echo']);
    expect(registrations[0].parameters).toEqual(tool().parameters);
  });

  test('session-scoped tools are only visible in their session', () => {
    const registry = createToolContributionRegistry();
    registry.register(tool({ name: 'global' }));
    registry.register(tool({ name: 'local', scope: 'session', sessionID: 's1' }));
    expect(registry.list('s1').map((t) => t.name)).toEqual(['global', 'local']);
    expect(registry.list('s2').map((t) => t.name)).toEqual(['global']);
  });

  test('re-registration replaces the handler and the old unregister is safe', async () => {
    const registry = createToolContributionRegistry();
    const unregisterOld = registry.register(tool({ execute: async () => ({ text: 'old' }) }));
    registry.register(tool({ execute: async () => ({ text: 'new' }) }));
    unregisterOld();
    await expect(registry.invoke('plugin:demo:echo', {}, { sessionID: 's1' })).resolves.toEqual({ text: 'new' });
  });

  test('handler errors and timeouts become tool errors', async () => {
    const registry = createToolContributionRegistry({ defaultTimeoutMs: 10 });
    registry.register(tool({ name: 'boom', execute: async () => { throw new Error('boom'); } }));
    registry.register(tool({ name: 'slow', execute: () => new Promise(() => {}) }));
    await expect(registry.invoke('plugin:demo:boom', {}, { sessionID: 's1' })).resolves.toMatchObject({ isError: true, text: expect.stringContaining('boom') });
    await expect(registry.invoke('plugin:demo:slow', {}, { sessionID: 's1' })).resolves.toMatchObject({ isError: true, text: expect.stringContaining('timed out') });
  });

  test('unknown and unhealthy tools fail closed without throwing', async () => {
    const registry = createToolContributionRegistry();
    registry.register(tool({ name: 'sick', health: () => 'failed' }));
    await expect(registry.invoke('plugin:demo:missing', {}, { sessionID: 's1' })).resolves.toMatchObject({ isError: true });
    await expect(registry.invoke('plugin:demo:sick', {}, { sessionID: 's1' })).resolves.toMatchObject({ isError: true });
  });

  test('rejects bad names and session scope without sessionID', () => {
    const registry = createToolContributionRegistry();
    expect(() => registry.register(tool({ name: 'a:b' }))).toThrow(/name/);
    expect(() => registry.register(tool({ scope: 'session' }))).toThrow(/sessionID/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/tools.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 registry**

实现要点：全名映射 `Map<string, { contribution; version }>`；`factory()` 每次调用 `toRegistration`；`invoke` 用 `find` 精确匹配全名；timeout 用 `AbortController` + `Promise.race`；`dispose` 逆序。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/tools.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/tools.ts gateway/tests/unit/kernel-v2/tools.test.ts
git commit -m "feat(kernel-v2): add plugin tool contribution registry"
```

---

### Task 3.5：Tools conformance kit + fixture

**Files:**
- Create: `gateway/tests/helpers/kernel-v2/tools-conformance.ts`
- Create: `gateway/tests/fixtures/kernel-v2/plugin-tool-echo.ts`
- Create: `gateway/tests/unit/kernel-v2/tools-conformance.test.ts`

**Interfaces:**
```ts
export interface ToolsConformanceFactory {
  create(): ReturnType<typeof createToolContributionRegistry>;
}
export function runToolsConformance(name: string, factory: ToolsConformanceFactory): void;
```

Kit 覆盖：命名空间、session 可见性、重注册、handler 失败、timeout、unknown/unhealthy、dispose。

- [ ] **Step 1: 写失败测试**

```ts
import { createToolContributionRegistry } from '../../../src/kernel-v2/tools';
import { runToolsConformance } from '../../helpers/kernel-v2/tools-conformance';

runToolsConformance('tool registry', {
  create: () => createToolContributionRegistry({ defaultTimeoutMs: 20 }),
});

test('test package tool is callable without core edits', async () => {
  const { createPluginToolEcho } = await import('../../fixtures/kernel-v2/plugin-tool-echo');
  const registry = createToolContributionRegistry();
  registry.register(createPluginToolEcho());
  await expect(registry.invoke('plugin:demo:echo', { text: 'hi' }, { sessionID: 's1' })).resolves.toEqual({ text: 'echo:hi' });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/tools-conformance.test.ts`
Expected: FAIL — helper/fixture not found

- [ ] **Step 3: 实现 kit 与 fixture**

fixture 的 `execute` 返回 `{ text: 'echo:' + String(input?.text ?? '') }`。Kit 用标准 contribution 集合。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/tools-conformance.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/tests/helpers/kernel-v2/tools-conformance.ts gateway/tests/fixtures/kernel-v2/plugin-tool-echo.ts gateway/tests/unit/kernel-v2/tools-conformance.test.ts
git commit -m "test(kernel-v2): add tools conformance kit and package fixture"
```

**Milestone 3B gate:** plugin-contract tools 声明可校验；registry 可生成 `MafwToolRegistration`；失败隔离与 scope 全绿。

---

## Milestone 3C：G3 集成证明

### Task 3.6：Canonical event snapshot helper

**Files:**
- Create: `gateway/src/kernel-v2/canonical-event.ts`
- Test: `gateway/tests/unit/kernel-v2/canonical-event.test.ts`

**Interfaces:**
```ts
export interface EventFacetLike {
  type: string;
  sessionID?: string;
  directory?: string;
  properties?: Record<string, unknown>;
}

export function toCanonicalEvent(facets: EventFacetLike, at?: number): CanonicalEvent;
```

规则：只保留 `type`、`sessionID`、`at`、`properties`；`projectId` 从 `properties.projectId` 或 `directory` 提取；**不**复制 prompt/token/secret；未知字段丢弃。

- [ ] **Step 1: 写失败测试**

```ts
test('copies only the canonical snapshot fields', () => {
  const event = toCanonicalEvent({
    type: 'tool.updated',
    sessionID: 's1',
    directory: 'C:/p',
    properties: { tool: 'x', prompt: 'secret', apiToken: 'sk' },
  }, 123);
  expect(event).toEqual({ type: 'tool.updated', sessionID: 's1', at: 123, properties: { tool: 'x' } });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/canonical-event.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

用 allowlist 复制 `type/sessionID/at/projectId/properties`；`properties` 只复制浅层，剔除 key 匹配 `/token|secret|password|prompt|apikey|authorization/i` 的字段。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/canonical-event.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/canonical-event.ts gateway/tests/unit/kernel-v2/canonical-event.test.ts
git commit -m "feat(kernel-v2): add sanitized canonical event snapshot"
```

---

### Task 3.7：G3 fake runtime + observer harness

**Files:**
- Create: `gateway/tests/integration/kernel-v2-g3.test.ts`
- Consumes: Task 3.1/3.4/3.6 + fixtures

**Test shape:**

```ts
class FakeRuntime {
  registrations: MafwToolRegistration[] = [];
  tools = {
    registerTools: async (factory: (sessionID: string) => MafwToolRegistration[]) => {
      this.registrations = factory('s1');
    },
    nativeTools: () => [],
  };
}

test('G3: plugin tool is callable through RuntimeTools.registerTools', async () => {
  const tools = createToolContributionRegistry();
  tools.register(createPluginToolEcho());
  const runtime = new FakeRuntime();
  await runtime.tools.registerTools(tools.factory());
  const echo = runtime.registrations.find((r) => r.name === 'plugin:demo:echo');
  await expect(echo!.execute({ text: 'hi' })).resolves.toEqual({ text: 'echo:hi' });
});

test('G3: observer receives tool events and a bad observer cannot block the call', async () => {
  const observer = new CanonicalObserverRegistry();
  const seen: string[] = [];
  observer.register({ id: 'bad', filter: { types: ['tool.*'] }, onEvent: () => { throw new Error('boom'); } });
  observer.register({ id: 'good', filter: { types: ['tool.*'] }, onEvent: (e) => { seen.push(e.type); } });
  observer.dispatch(toCanonicalEvent({ type: 'tool.updated', sessionID: 's1', properties: { tool: 'x' } }));
  await observer.drain();
  expect(seen).toEqual(['tool.updated']);
});
```

- [ ] **Step 1: 写失败测试**

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/integration/kernel-v2-g3.test.ts`
Expected: FAIL — modules not found (before Task 3.1/3.4/3.6 land)

- [ ] **Step 3: 跑测试确认通过**

Run: `npx jest --runInBand tests/integration/kernel-v2-g3.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 4: 提交**

```bash
git add gateway/tests/integration/kernel-v2-g3.test.ts
git commit -m "test(kernel-v2): prove G3 tools and observer harness"
```

---

### Task 3.8：边界守卫、文档与交付记录

**Files:**
- Modify: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`
- Modify: `docs/architecture/gateway.md`
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- Create: `docs/releases/2026-11-12-capability-kernel-phase3.md`
- Modify: 本 plan（Progress）

- [ ] **Step 1: 守卫**

新增断言：`kernel-v2/observer.ts` / `tools.ts` / `canonical-event.ts` 不 import `runtime/event-dispatch.ts`、`runtime/mafw-tools.ts`、`server/event-hub.ts`、`plugin-host` 等 live 组合根；tool 类型只 import `runtime/contract` 的 type。

- [ ] **Step 2: 更新架构文档**

kernel-v2 段增加 Phase 3 清单：observer（只读/fail-open/queue/timeout）、tool registry（namespace/scope/timeout）、canonical snapshot（脱敏）、G3 harness。明确 live 接线未做。

- [ ] **Step 3: 更新路线图**

Phase 3 标记“已交付（conformance harness）”，并注明 live wiring 在 Phase 3.5/4 cutover；`interceptor` 仍未开放。

- [ ] **Step 4: 写交付记录**

包含：日期、版本 5.1.0、commit、定向测试数、全量连续 2 次、typecheck、未做（live 接线、interceptor、worker 隔离）、rollback（不注册 observer/tool 即恢复）。

- [ ] **Step 5: 跑最终门禁**

```bash
cd gateway
npx jest --runInBand tests/unit/kernel-v2 tests/unit/architecture/kernel-v2-boundaries.test.ts tests/integration/kernel-v2-g3.test.ts tests/integration/kernel-v2-g2.test.ts tests/integration/kernel-v2-shadow.test.ts
npx tsc --noEmit -p tsconfig.json
npx jest --runInBand --forceExit
npx jest --runInBand --forceExit
```

Expected: 定向全绿；typecheck 通过；全量连续 2 次 clean。若出现 `instance-ownership` 时序 flake，单文件重跑并记录。

- [ ] **Step 6: 提交**

```bash
git add gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts docs/architecture/gateway.md docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md docs/releases/2026-11-12-capability-kernel-phase3.md docs/superpowers/plans/2026-11-12-kernel-v2-phase3-agent-tools-observer.md
git commit -m "docs: record kernel-v2 phase 3 tools and observer"
```

**Gate G3：** 测试包 tools 可被 fake runtime 调用；observer 收到 tool 事件；坏 observer 不阻塞；v1 零行为变化。

---

## Self-Review

- **Spec coverage:** S5 observer probe、tools contribution、plugin-contract tools 声明、G3 harness 均有 task。
- **Step scan:** 每个 task 有失败测试、失败运行、实现、通过运行、提交；测试断言给出具体值。
- **Type consistency:** `CanonicalEvent` / `ObserverFilter` / `ToolContribution` / `MafwToolRegistration` 名称跨 task 一致；`createToolContributionRegistry` 返回类型在 kit 与 integration 复用。
- **Review Focus:** 非阻塞、scope、tool 失败隔离、session scope、secret 脱敏、人类验收不可绕过均有对应测试或约束。
- **Proportion:** 计划只写接口、语义和测试断言，不写实现体。

## Execution Handoff

按 Milestone 3A → 3C 顺序执行；S5 先于 tools/observer 集成。执行方式沿用 native（不使用 worktree）。
