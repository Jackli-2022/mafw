# Kernel v2 Phase 3.6 Plugin Host Auto-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一插件包在 `activate()` 返回 `tools` / `observers` 后，由 `PluginHost` 自动同步到 Phase 3.5 的 `runtime/v2-live` bridge；commit/reload/remove/disable 时按 revision 自动注册和退订。

**Architecture:** 不改变 `plugin.json` 安装流程，也不把 Host handler 序列化给 Desktop。`PluginHost` 只发布中性的 `PluginToolEntry[]` / `PluginObserverEntry[]`（含 revision）；`kernel.ts` 通过 `bindKernelV2` 把它们交给 `runtime/v2-live.ts`；`v2-live` 负责 diff、命名空间和注册。flag 关闭时 callback 是 no-op。

**Tech Stack:** TypeScript / Node、Jest（gateway）、现有 `PluginHost` / `package-validator` / `PluginActionDeclaration` / `ToolContributionRegistry` / `CanonicalObserverRegistry`。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

**Roadmap:** `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`

## Progress（2026-11-13）

- Task 3.6.1–3.6.5 全部完成。
- 定向门禁：**531 / 531 pass**；新增 5 个测试。
- gateway 全量：**7005 passed / 1 skipped / 7006 total**，run 4/5 连续 clean；run 1/3 的 worktree 5s timeout 为负载下的既存 flake，单文件重跑通过。
- typecheck（gateway）：通过。
- 交付记录：`docs/releases/2026-11-13-capability-kernel-phase3-6.md`。
- 默认两个 flag 都关闭；包 tools/observers 仅校验，不执行。

## Global Constraints

- 默认行为不变：`MAFW_KERNEL_V2_TOOLS` / `MAFW_KERNEL_V2_OBSERVERS` 未开启时，package tools/observers 只被校验和记录，不执行。
- Handler 永远留在 gateway 进程内，不进入 client descriptor / Desktop。
- Tool 命名空间 `plugin:<package>:<tool>`；observer id `plugin:<package>:<observer>`。
- Package tool handler 失败/超时只返回 tool error，不拖垮 turn。
- Observer 只读、post-hoc、fail-open；不能 veto/rewrite。
- 人类验收/审批/权限/审计不变；package 不能通过 tools/observers 绕过。
- `activate()` 返回的 tools/observers 必须在 commit 时才注册；pending/failed candidate 不得提前生效。
- 同一包 reload 必须使用新 revision 替换旧 handler；remove/disable 必须退订。
- 本 phase 不支持 package 的 `scope: 'session'` tool（包在会话之前激活）；显式拒绝并给出清晰错误。
- 所有生产代码先写失败测试；每个 task 结束提交。

## Review Focus

- **pending 不生效**：staged candidate 的 tools/observers 不能进入 live registry，只有 commit 后发布。
- **revision 替换**：同包 reload 后旧 handler 不再被调用；observer 不重复触发。
- **移除/禁用**：包删除或 disabled 后 entries 消失，registry 退订。
- **失败隔离**：tool handler 抛错/超时、observer 抛错/超时都只影响自身。
- **命名空间**：包不能注册 canonical 工具名或别的包的工具名；observer 不能抢占 builtin id。
- **脱敏**：observer 收到的仍是 `toCanonicalEvent` 快照，不含 prompt/token/secret。

---

## File Structure

```text
gateway/src/plugins/
  package-types.ts          # 修改：PluginToolDeclaration / PluginObserverDeclaration / entries
  package-validator.ts      # 修改：tools/observers 校验与 activated 投影
  package-host.ts           # 修改：bindKernelV2 + publishEntries 发布 entries
gateway/src/runtime/
  v2-live.ts                # 修改：syncPluginContributions（diff/revision/namespace）
gateway/src/kernel.ts       # 修改：bindKernelV2 接线
gateway/tests/unit/plugins/
  package-validator.test.ts # 修改：tools/observers 校验
  package-host.test.ts      # 修改：commit/remove 发布 entries
gateway/tests/unit/runtime/
  v2-live.test.ts           # 修改：sync/diff/revision/失败隔离
docs/releases/
  2026-11-13-capability-kernel-phase3-6.md
```

---

## Task 3.6.1：Package contribution types

**Files:**
- Modify: `gateway/src/plugins/package-types.ts`

**Interfaces:**
```ts
export interface PluginCanonicalEvent {
  type: string;
  sessionID?: string;
  projectId?: string;
  at: number;
  properties?: Record<string, unknown>;
}

export interface PluginObserverFilter {
  sessionID?: string;
  projectId?: string;
  types?: string[];
}

export interface PluginToolDeclaration {
  name: string;
  title?: string;
  description: string;
  inputSchema: PluginJsonSchema;
  outputSchema?: PluginJsonSchema;
  timeoutMs?: number;
  /** Package tools are global in this phase; session scope is rejected. */
  scope?: 'global';
  handler(
    input: unknown,
    call: { sessionID?: string; signal: AbortSignal },
  ): unknown | Promise<unknown>;
}

export interface PluginObserverDeclaration {
  id: string;
  title?: string;
  description?: string;
  filter?: PluginObserverFilter;
  timeoutMs?: number;
  onEvent(event: PluginCanonicalEvent): void | Promise<void>;
}

export interface PluginToolEntry extends PluginToolDeclaration {
  packageName: string;
  revision: string;
}

export interface PluginObserverEntry extends PluginObserverDeclaration {
  packageName: string;
  revision: string;
}

export interface UnifiedPluginContributions extends PluginContributions {
  ui?: PluginUiContribution;
  actions?: Record<string, PluginActionDeclaration>;
  events?: PluginEventDeclaration[];
  tools?: PluginToolDeclaration[];
  observers?: PluginObserverDeclaration[];
}

export interface ActivatedContributions {
  ui: PluginUiContribution;
  actions: ActivatedAction[];
  events: ActivatedEvent[];
  tools: PluginToolDeclaration[];
  observers: PluginObserverDeclaration[];
  legacy: PluginContributions;
}
```

- [ ] **Step 1: 修改类型**

- [ ] **Step 2: typecheck 确认现有使用点报错（预期：ActivatedContributions 缺 tools/observers）**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: FAIL — `buildActivatedContributions` 返回对象缺字段

- [ ] **Step 3: 提交**

```bash
git add gateway/src/plugins/package-types.ts
git commit -m "feat(plugins): add tool and observer contribution types"
```

---

## Task 3.6.2：Validation + activated projection

**Files:**
- Modify: `gateway/src/plugins/package-validator.ts`
- Modify: `gateway/tests/unit/plugins/package-validator.test.ts`

**Validation 规则：**

Tools：

- `tools` 必须是数组；每项 object。
- `name` 非空、≤128、`NAME_PATTERN`；重复 → error。
- `description` 非空字符串。
- `inputSchema` 必填 object，`validatePluginSchema`；`outputSchema` 可选。
- `timeoutMs` 正整数 ≤ `PLUGIN_UI_LIMITS.maxActionTimeoutMs`。
- `scope` 只允许 `global`；`session` → `package tools do not support session scope yet`。
- `handler` 必须是 function。
- 未知字段拒绝。

Observers：

- `observers` 必须是数组；每项 object。
- `id` 非空、≤128、`NAME_PATTERN`；重复 → error。
- `filter` 可选 object，只允许 `sessionID` / `projectId` / `types`；`types` 是非空字符串数组，最多 32 个。
- `timeoutMs` 正整数 ≤ `PLUGIN_UI_LIMITS.maxActionTimeoutMs`。
- `onEvent` 必须是 function。
- 未知字段拒绝。

`buildActivatedContributions`：

- `activation.tools = contributions.tools ?? []`
- `activation.observers = contributions.observers ?? []`
- 从 `legacy` 中移除 `tools` / `observers`。
- `analyze` 失败时返回空 tools/observers。

- [ ] **Step 1: 写失败测试**

```ts
it('accepts tool and observer declarations', () => {
  const built = buildActivatedContributions('demo', {
    tools: [{
      name: 'echo',
      description: 'Echo input',
      inputSchema: { type: 'object' },
      handler: async () => 'ok',
    }],
    observers: [{
      id: 'watch',
      filter: { types: ['part.updated'] },
      onEvent: () => undefined,
    }],
  }, CANONICAL);
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.value.tools.map((t) => t.name)).toEqual(['echo']);
  expect(built.value.observers.map((o) => o.id)).toEqual(['watch']);
  expect((built.value.legacy as any).tools).toBeUndefined();
});

it('rejects bad tool names, session scope, duplicate observers and missing handlers', () => {
  const errors = validateUnifiedContributions('demo', {
    tools: [
      { name: 'a:b', description: 'x', inputSchema: {}, handler: () => null },
      { name: 'ok', description: 'x', inputSchema: {}, scope: 'session', handler: () => null },
      { name: 'nohandler', description: 'x', inputSchema: {} } as any,
    ],
    observers: [
      { id: 'same', onEvent: () => undefined },
      { id: 'same', onEvent: () => undefined },
    ],
  }, CANONICAL).join('\n');
  expect(errors).toMatch(/a:b/);
  expect(errors).toMatch(/session scope/);
  expect(errors).toMatch(/handler/);
  expect(errors).toMatch(/duplicate observer/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/plugins/package-validator.test.ts`
Expected: FAIL — tools/observers 被忽略

- [ ] **Step 3: 实现校验与投影**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/plugins/package-validator.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/plugins/package-validator.ts gateway/tests/unit/plugins/package-validator.test.ts
git commit -m "feat(plugins): validate tool and observer contributions"
```

---

## Task 3.6.3：PluginHost publish + bind

**Files:**
- Modify: `gateway/src/plugins/package-host.ts`
- Modify: `gateway/tests/unit/plugins/package-host.test.ts`

**Interfaces:**
```ts
bindKernelV2(cb: (tools: PluginToolEntry[], observers: PluginObserverEntry[]) => void): void;
```

- `lastTools` / `lastObservers` 字段；bind 时立即回放。
- `publishEntries()` 从 active records 构建：
  ```ts
  tools.push({ ...declaration, packageName: record.descriptor.name, revision: record.revision });
  observers.push({ ...declaration, packageName: record.descriptor.name, revision: record.revision });
  ```
  然后 `this.kernelV2Cb?.(tools, observers)`。
- `activate()`：`kinds.push('tools')` / `kinds.push('observers')`；`no contributions` 错误信息包含 tools/observers。
- `stop()`：`this.kernelV2Cb?.([], [])`。

- [ ] **Step 1: 写失败测试**

```ts
const TOOLFUL = (name: string) => `
module.exports = { name: '${name}', async activate() {
  return {
    tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, handler: async (input) => ({ text: 'ok' }) }],
    observers: [{ id: 'watch', filter: { types: ['part.updated'] }, onEvent() {} }],
  };
} };
`;

it('publishes tool/observer entries on commit and clears them on remove', async () => {
  const file = path.join(dir, 'toolful.js');
  fs.writeFileSync(file, TOOLFUL('toolful'));
  host = mkHost(dir, { createBag });
  const published: Array<{ tools: any[]; observers: any[] }> = [];
  host.bindKernelV2((tools, observers) => { published.push({ tools, observers }); });
  await host.init();

  expect(published.at(-1)!.tools).toHaveLength(1);
  expect(published.at(-1)!.tools[0]).toMatchObject({ packageName: 'toolful', name: 'echo' });
  expect(published.at(-1)!.observers[0]).toMatchObject({ packageName: 'toolful', id: 'watch' });

  fs.unlinkSync(file);
  await host.reload();
  expect(published.at(-1)!.tools).toEqual([]);
  expect(published.at(-1)!.observers).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/plugins/package-host.test.ts`
Expected: FAIL — bindKernelV2 not a function

- [ ] **Step 3: 实现 publish + bind**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/plugins/package-host.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/package-host.test.ts
git commit -m "feat(plugins): publish tool and observer entries"
```

---

## Task 3.6.4：v2-live sync + kernel bind

**Files:**
- Modify: `gateway/src/runtime/v2-live.ts`
- Modify: `gateway/src/kernel.ts`
- Modify: `gateway/tests/unit/runtime/v2-live.test.ts`

**Interfaces:**
```ts
syncPluginContributions(tools: PluginToolEntry[], observers: PluginObserverEntry[]): void;
```

语义：

- Tools flag 关闭 → 忽略 tools；Observers flag 关闭 → 忽略 observers。
- 维护 `Map<key, { revision, unregister }>`：
  - key = `${packageName}:${name}` / `${packageName}:${id}`。
  - 不在下一批 → unregister + delete。
  - revision 未变 → 保留。
  - revision 变 → unregister 旧的，注册新的。
- Tool entry → `ToolContribution`：
  - `scope: 'global'`
  - `parameters: entry.inputSchema`
  - `execute`: `await entry.handler(input, { sessionID, signal })`，结果归一化：
    - string → `{ text }`
    - `{ text, isError? }` → 保留
    - 其他 → `JSON.stringify` / `String`
  - 错误不 catch（让 registry 的 timeout/error 隔离处理）。
- Observer entry → `CanonicalObserver`：
  - `id: plugin:${packageName}:${id}`
  - `filter`, `timeoutMs`, `onEvent`
- `dispose()` 先 unregister 全部，再 dispose registries。

Kernel：

- `initServices()` 中在 `bindMedia` 附近：
  ```ts
  this.pluginHost?.bindKernelV2((tools, observers) => {
    this.kernelV2Live?.syncPluginContributions(tools, observers);
  });
  ```

- [ ] **Step 1: 写失败测试**

```ts
test('syncs package tools and observers, replaces on revision change, clears on removal', async () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_OBSERVERS: '1', MAFW_KERNEL_V2_TOOLS: '1' } })!;
  const seen: any[] = [];
  live.syncPluginContributions(
    [{ packageName: 'demo', revision: 'r1', name: 'echo', description: 'Echo', inputSchema: {}, handler: async () => 'v1' }],
    [{ packageName: 'demo', revision: 'r1', id: 'watch', filter: { types: ['part.updated'] }, onEvent: (e) => { seen.push(e.type); } }],
  );
  const tool = live.toolFactory()!('s1').find((r) => r.name === 'plugin:demo:echo')!;
  await expect(tool.execute({})).resolves.toEqual({ text: 'v1' });
  live.observe({ type: 'part.updated', sessionID: 's1' });
  await live.drain();
  expect(seen).toEqual(['part.updated']);

  live.syncPluginContributions(
    [{ packageName: 'demo', revision: 'r2', name: 'echo', description: 'Echo', inputSchema: {}, handler: async () => 'v2' }],
    [],
  );
  const tool2 = live.toolFactory()!('s1').find((r) => r.name === 'plugin:demo:echo')!;
  await expect(tool2.execute({})).resolves.toEqual({ text: 'v2' });
  live.observe({ type: 'part.updated', sessionID: 's1' });
  await live.drain();
  expect(seen).toEqual(['part.updated']);

  live.syncPluginContributions([], []);
  expect(live.toolFactory()!('s1')).toEqual([]);
  await live.dispose();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/v2-live.test.ts`
Expected: FAIL — syncPluginContributions not a function

- [ ] **Step 3: 实现 sync + kernel bind**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/v2-live.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/v2-live.ts gateway/src/kernel.ts gateway/tests/unit/runtime/v2-live.test.ts
git commit -m "feat(runtime): sync plugin tools and observers into live bridge"
```

---

## Task 3.6.5：Docs + final gate

**Files:**
- Modify: `docs/architecture/gateway.md`
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- Create: `docs/releases/2026-11-13-capability-kernel-phase3-6.md`
- Modify: 本 plan（Progress）

- [ ] **Step 1: 更新架构文档**

补充：`activate()` 可返回 `tools` / `observers`；PackageHost 发布 entries；kernel `bindKernelV2`；v2-live 按 revision diff；默认 flag 关闭；session-scope package tool 暂不支持。

- [ ] **Step 2: 路线图**

Phase 3.6 标记已交付；Phase 4 仍从 S4 开始。

- [ ] **Step 3: 交付记录**

包含：日期、版本 5.1.0、commit、定向/全量测试数、typecheck、未做（静态 manifest 交叉校验、session-scope tool、interceptor、worker）、rollback（禁用包/关 flag）。

- [ ] **Step 4: 最终门禁**

```bash
cd gateway
npx jest --runInBand tests/unit/plugins tests/unit/runtime/v2-live.test.ts tests/unit/runtime/event-dispatch.test.ts tests/unit/runtime/mafw-tools.test.ts tests/unit/kernel-v2 tests/unit/architecture/kernel-v2-boundaries.test.ts tests/integration/kernel-v2-g3.test.ts tests/integration/kernel-v2-g2.test.ts tests/integration/kernel-v2-shadow.test.ts
npx tsc --noEmit -p tsconfig.json
npx jest --runInBand --forceExit
npx jest --runInBand --forceExit
```

Expected: 定向全绿；typecheck 通过；全量连续 2 次 clean。

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/gateway.md docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md docs/releases/2026-11-13-capability-kernel-phase3-6.md docs/superpowers/plans/2026-11-13-kernel-v2-plugin-host-auto-registration.md
git commit -m "docs: record plugin host auto-registration"
```

**Gate G3.6：** 包 activate 贡献 tools/observers → commit 后自动注册；reload 换 revision；remove/disable 退订；flag 关闭零执行；全量绿。

---

## Self-Review

- **Spec coverage:** activate 贡献、validator、PackageHost 发布、v2-live diff、kernel bind、回滚均有 task。
- **Step scan:** 每个 task 先失败测试；测试断言给出具体值。
- **Type consistency:** `PluginToolDeclaration` / `PluginToolEntry` / `ToolContribution` 字段一致；observer id 命名空间一致。
- **Review Focus:** pending 不生效（commit 后 publish）、revision 替换、remove 清空、失败隔离、命名空间、脱敏均有测试。
- **Proportion:** 计划只写接口、语义和测试断言，不写实现体。

## Execution Handoff

按 Task 3.6.1 → 3.6.5 顺序执行；默认 flag 关闭，测试用显式 env 打开 bridge。执行方式沿用 native（不使用 worktree）。
