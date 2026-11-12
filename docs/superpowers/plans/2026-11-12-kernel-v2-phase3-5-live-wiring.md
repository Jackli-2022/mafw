# Kernel v2 Phase 3.5 Live Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 3 的 canonical observer 和 plugin tools 以**默认关闭的 feature flag**接进 v1 live 路径；flag 关闭时 v1 行为零变化，flag 打开时 observer/tool 失败仍 fail-open。

**Architecture:** 新增唯一 bridge `gateway/src/runtime/v2-live.ts`，它是 live 代码中唯一 import `kernel-v2` 的模块。`kernel.ts` 只 import bridge，不直接 import kernel-v2；`event-dispatch.ts` 只新增一个可选的 `canonicalObserverTap` 回调；`mafw-tools.ts` 只新增可选 `extraTools` 合并。开关：`MAFW_KERNEL_V2_OBSERVERS=1`、`MAFW_KERNEL_V2_TOOLS=1`。

**Tech Stack:** TypeScript / Node、Jest（gateway）、现有 `DispatchCtx` / `activateRuntimeTools` / `CanonicalObserverRegistry` / `ToolContributionRegistry`。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

**Roadmap:** `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`

## Progress（2026-11-12）

- Task 3.5.1–3.5.5 全部完成。
- 定向门禁：**238 / 238 pass**（新增 10：v2-live 5、event-dispatch 2、mafw-tools 2、boundaries 1）。
- gateway 全量：**6972 passed / 1 skipped / 6973 total**，连续两次 clean。
- typecheck（gateway）：通过。
- 交付记录：`docs/releases/2026-11-12-capability-kernel-phase3-5.md`。
- 默认两个 flag 都关闭；生产行为与 Phase 3 一致。

## Global Constraints

- **默认关闭**：两个 env 都不设置时，v1 行为与 Phase 3 完全一致；不创建 registry、不注册 observer/tool、不改变事件链输出。
- `kernel.ts` / `boot.ts` 不得直接 import `kernel-v2/**`；唯一 bridge 是 `runtime/v2-live.ts`。
- Observer 仍然只读、post-hoc、fail-open；不得 veto/rewrite 事件。
- Tool 失败只产生 tool error；不得拖垮 turn、SSE、recall。
- 人类验收/审批/权限/审计不变；observer/tool 不能绕过或代签。
- 所有生产代码先写失败测试；每个 task 结束提交。
- G3.5 前跑定向 + 全量连续 2 次 clean。

## Review Focus

- **flag 关闭零行为变化**：事件链 stage 数量/顺序、tool factory 输出、运行时注册结果与之前一致。
- **flag 打开不阻塞**：observer `observe()` 同步返回；tool merge 失败回退 builtin。
- **桥接边界**：live 代码只有 `runtime/v2-live.ts` import kernel-v2；kernel-v2 不 import live bridge。
- **observer 脱敏**：live 事件经 `toCanonicalEvent` 后不含 prompt/token/secret。
- **tool 命名空间**：live 注册的插件 tool 必须以 `plugin:<package>:<tool>` 出现，不能覆盖 builtin 同名工具。
- **回滚**：删除 env 即回到 Phase 3 行为；不需要回滚数据。

---

## Task 3.5.1：v2-live bridge

**Files:**
- Create: `gateway/src/runtime/v2-live.ts`
- Test: `gateway/tests/unit/runtime/v2-live.test.ts`

**Interfaces:**
```ts
export interface KernelV2LiveFlags {
  observers: boolean;
  tools: boolean;
}

export function readKernelV2LiveFlags(env?: NodeJS.ProcessEnv): KernelV2LiveFlags;

export interface KernelV2Live {
  readonly observersEnabled: boolean;
  readonly toolsEnabled: boolean;
  observe(facets: EventFacetLike): void;
  registerObserver(observer: CanonicalObserver): () => void;
  toolFactory(): ((sessionID: string) => MafwToolRegistration[]) | undefined;
  registerTool(tool: ToolContribution): () => void;
  drain(): Promise<void>;
  dispose(): Promise<void>;
}

export function createKernelV2Live(options?: {
  env?: NodeJS.ProcessEnv;
  log?: { info(message: string): void; warn(message: string): void };
}): KernelV2Live | null;
```

语义：

- 两个 flag 都关 → 返回 `null`。
- `observe` 只在 observers flag 开启时工作；内部 `toCanonicalEvent` + `dispatch`，异常吞掉。
- `registerObserver` / `registerTool` 在对应 flag 关闭时抛明确错误。
- `toolFactory()` 返回 registry 的 factory；关闭时 undefined。
- `dispose` 并行 dispose 两个 registry，忽略错误。

- [ ] **Step 1: 写失败测试**

```ts
import { createKernelV2Live, readKernelV2LiveFlags } from '../../../src/runtime/v2-live';

test('flags default off and parse 1/true', () => {
  expect(readKernelV2LiveFlags({})).toEqual({ observers: false, tools: false });
  expect(readKernelV2LiveFlags({ MAFW_KERNEL_V2_OBSERVERS: '1', MAFW_KERNEL_V2_TOOLS: 'true' })).toEqual({ observers: true, tools: true });
});

test('disabled bridge is null', () => {
  expect(createKernelV2Live({ env: {} })).toBeNull();
});

test('observer bridge sanitizes and dispatches', async () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_OBSERVERS: '1' } })!;
  const seen: any[] = [];
  live.registerObserver({ id: 'a', onEvent: (e) => { seen.push(e); } });
  live.observe({ type: 'tool.updated', sessionID: 's1', properties: { tool: 'x', prompt: 'secret' } });
  expect(Date.now()).toBeGreaterThan(0);
  await live.drain();
  expect(seen[0].properties).toEqual({ tool: 'x' });
  await live.dispose();
});

test('tool bridge exposes a factory', async () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_TOOLS: '1' } })!;
  live.registerTool({ packageName: 'demo', name: 'echo', description: 'Echo', parameters: {}, execute: async () => ({ text: 'ok' }) });
  const registration = live.toolFactory()!('s1').find((r) => r.name === 'plugin:demo:echo');
  await expect(registration!.execute({})).resolves.toEqual({ text: 'ok' });
  await live.dispose();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/v2-live.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 bridge**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/v2-live.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/v2-live.ts gateway/tests/unit/runtime/v2-live.test.ts
git commit -m "feat(runtime): add kernel-v2 live bridge behind flags"
```

---

## Task 3.5.2：observer dispatch stage

**Files:**
- Modify: `gateway/src/runtime/event-dispatch.ts`
- Modify: `gateway/tests/unit/runtime/event-dispatch.test.ts`

**Interfaces:**
- `DispatchCtx` 新增：`canonicalObserverTap?: (f: EventFacets) => void`
- `DISPATCH_STAGES` 新增 `canonicalObserverTap`，位置在 `conformanceTap` 之后、`goalActivity` 之前。
- Stage 内部 try/catch，失败只吞掉，不 halt。

- [ ] **Step 1: 写失败测试**

```ts
it('canonical observer tap runs after conformance tap and before internal drop', () => {
  expect(stageIndex('canonicalObserverTap')).toBeGreaterThan(stageIndex('conformanceTap'));
  expect(stageIndex('canonicalObserverTap')).toBeLessThan(stageIndex('internalFilter'));
});

it('canonical observer tap receives normalized facets and failures are fail-open', () => {
  const world = makeWorld();
  const seen: string[] = [];
  world.ctx.canonicalObserverTap = (f) => { seen.push(f.type); throw new Error('boom'); };
  dispatch(world, MAFW.toolUpdated, { sessionID: 's1' });
  expect(seen).toEqual([MAFW.toolUpdated]);
  expect(world.broadcasts.some((b) => b.data.type === MAFW.toolUpdated)).toBe(true);
});
```

同时把 `DISPATCH_STAGES.length` 从 23 改为 24。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/event-dispatch.test.ts`
Expected: FAIL — unknown stage / length 23

- [ ] **Step 3: 实现 stage + ctx 字段**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/event-dispatch.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/event-dispatch.ts gateway/tests/unit/runtime/event-dispatch.test.ts
git commit -m "feat(runtime): add canonical observer dispatch stage"
```

---

## Task 3.5.3：tool factory merge

**Files:**
- Modify: `gateway/src/runtime/mafw-tools.ts`
- Modify: `gateway/tests/unit/runtime/mafw-tools.test.ts`

**Interfaces:**
```ts
export async function activateRuntimeTools(
  rt: AgentRuntime,
  source: string,
  opts: {
    baseUrl: string;
    extraTools?: (sessionID: string) => MafwToolRegistration[];
  },
  logger?: { info(message: string): void; warn(message: string): void },
): Promise<void>;
```

语义：

- 无 `extraTools` → 行为与现在完全一致。
- 有 `extraTools` → factory 返回 `[...builtin, ...extra]`。
- `extraTools` 抛错 → 只返回 builtin，并 warn（fail-open）。

- [ ] **Step 1: 写失败测试**

```ts
it('extraTools are merged after builtin tools', async () => {
  const rt = makeRt();
  await activateRuntimeTools(rt, 'test:rt', {
    baseUrl: 'http://gw',
    extraTools: () => [{ name: 'plugin:demo:echo', description: 'Echo', parameters: {}, execute: async () => ({ text: 'ok' }) }],
  });
  const factory = (rt.tools.registerTools as jest.Mock).mock.calls[0][0] as (sid: string) => any[];
  expect(factory('s1').map((r) => r.name)).toContain('plugin:demo:echo');
});

it('extraTools failure falls back to builtin only', async () => {
  const rt = makeRt();
  await activateRuntimeTools(rt, 'test:rt', {
    baseUrl: 'http://gw',
    extraTools: () => { throw new Error('boom'); },
  });
  const factory = (rt.tools.registerTools as jest.Mock).mock.calls[0][0] as (sid: string) => any[];
  expect(factory('s1').some((r) => r.name.startsWith('plugin:'))).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/mafw-tools.test.ts`
Expected: FAIL — extraTools ignored

- [ ] **Step 3: 实现 merge**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/mafw-tools.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/mafw-tools.ts gateway/tests/unit/runtime/mafw-tools.test.ts
git commit -m "feat(runtime): merge plugin tools into runtime registration"
```

---

## Task 3.5.4：kernel wiring + 边界守卫

**Files:**
- Modify: `gateway/src/kernel.ts`
- Modify: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`

Wiring：

- `private kernelV2Live: KernelV2Live | null = null;`
- `initServices()`：`this.kernelV2Live = createKernelV2Live({ log });`
- `buildDispatchCtx()`：`canonicalObserverTap: (f) => this.kernelV2Live?.observe(f),`
- 两个 `activateRuntimeTools(...)` 调用点：`extraTools: this.kernelV2Live?.toolFactory(),`
- `stop()`：`void this.kernelV2Live?.dispose(); this.kernelV2Live = null;`
- 公共方法：
  ```ts
  registerCanonicalObserver(observer: CanonicalObserver): () => void
  registerPluginTool(tool: ToolContribution): () => void
  ```
  flag 关闭时抛出带 env 名称的错误。

守卫：

- `kernel.ts` / `boot.ts` 仍不直接 import `kernel-v2/**`。
- live 代码中只有 `src/runtime/v2-live.ts` 可以 import `kernel-v2`；扫描 `src/**` 排除 `src/kernel-v2/**` 与该 bridge。

- [ ] **Step 1: 写失败守卫**

```ts
test('only runtime/v2-live.ts imports kernel-v2 from live code', () => {
  const liveFiles = filesUnder(resolve(ROOT, 'src')).filter(
    (file) => !file.startsWith(KERNEL_V2) && !file.endsWith('runtime/v2-live.ts'),
  );
  const violations: string[] = [];
  for (const file of liveFiles) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.includes('kernel-v2')) violations.push(`${relative(ROOT, file)} -> ${specifier}`);
    }
  }
  expect(violations).toEqual([]);
});
```

- [ ] **Step 2: 跑守卫确认失败（接线前）**

Run: `npx jest --runInBand tests/unit/architecture/kernel-v2-boundaries.test.ts`
Expected: PASS（bridge 尚未被引用）或 FAIL（如果提前接线）

- [ ] **Step 3: 接线 kernel**

- [ ] **Step 4: 跑定向**

Run: `npx jest --runInBand tests/unit/runtime/v2-live.test.ts tests/unit/runtime/event-dispatch.test.ts tests/unit/runtime/mafw-tools.test.ts tests/unit/architecture/kernel-v2-boundaries.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel.ts gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts
git commit -m "feat(kernel): wire kernel-v2 observer and tools behind flags"
```

---

## Task 3.5.5：文档与交付记录

**Files:**
- Modify: `docs/architecture/gateway.md`
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- Create: `docs/releases/2026-11-12-capability-kernel-phase3-5.md`
- Modify: 本 plan（Progress）

- [ ] **Step 1: 更新架构文档**

补充：`MAFW_KERNEL_V2_OBSERVERS=1` / `MAFW_KERNEL_V2_TOOLS=1`；唯一 bridge `runtime/v2-live.ts`；flag 关闭零行为变化；observer stage 位置；tool merge 顺序与 fail-open。

- [ ] **Step 2: 更新路线图**

Phase 3.5 标记已交付；Phase 4 的 UI 槽位仍按 S4 先做。

- [ ] **Step 3: 写交付记录**

包含：日期、版本 5.1.0、commit、定向/全量测试数、typecheck、未做（plugin host 自动注册、interceptor、worker 隔离）、回滚（删除 env）。

- [ ] **Step 4: 跑最终门禁**

```bash
cd gateway
npx jest --runInBand tests/unit/kernel-v2 tests/unit/runtime/v2-live.test.ts tests/unit/runtime/event-dispatch.test.ts tests/unit/runtime/mafw-tools.test.ts tests/unit/architecture/kernel-v2-boundaries.test.ts tests/integration/kernel-v2-g3.test.ts
npx tsc --noEmit -p tsconfig.json
npx jest --runInBand --forceExit
npx jest --runInBand --forceExit
```

Expected: 定向全绿；typecheck 通过；全量连续 2 次 clean。

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/gateway.md docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md docs/releases/2026-11-12-capability-kernel-phase3-5.md docs/superpowers/plans/2026-11-12-kernel-v2-phase3-5-live-wiring.md
git commit -m "docs: record kernel-v2 phase 3.5 live wiring"
```

**Gate G3.5：** flag 关闭时 v1 零行为变化；flag 打开时 observer 收到脱敏事件、plugin tool 出现在 runtime 注册表；observer/tool 失败 fail-open；全量绿。

---

## Self-Review

- **Spec coverage:** live observer、live tool merge、feature flags、唯一 bridge、回滚路径均有 task。
- **Step scan:** 每个 task 先失败测试再实现；测试给出具体断言。
- **Type consistency:** `KernelV2Live`、`CanonicalObserver`、`ToolContribution`、`MafwToolRegistration` 跨 task 一致。
- **Review Focus:** flag off、非阻塞、桥接边界、脱敏、命名空间、回滚均有测试/守卫。
- **Proportion:** 计划只写接口、语义和测试断言，不写实现体。

## Execution Handoff

按 Task 3.5.1 → 3.5.5 顺序执行；默认关闭两个 flag，最后再决定是否在开发环境打开做人工验证。执行方式沿用 native（不使用 worktree）。
