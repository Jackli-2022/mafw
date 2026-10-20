# Runtime 统一批（B1 入口执法 / B2 执行守卫 / B3 拦截可观测 / A canonical 翻译层 / D 加载收敛）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 事件入口 default-deny 声明制翻译（注册 = 唯一放行路径）+ 翻译执行守卫与拦截可观测 + 工具身份 canonical 翻译层 + runtime 加载路径收敛。

**Architecture:** `applyEventMappings` 删除 canonical 直发分支，放行唯一条件 = 命中注册翻译（差异行 / drop 行 / `canonicalIdentity()` 词汇单源派生的恒等行 / transformEvent）；未命中 → 拦截 + per-type 计数（unmatched vs suppressed 两类）。工具身份沿用同一模式：gateway 单点 `canonicalToolOf` 解析 → `part.canonicalTool` additive 字段双出口 enrich（live + 历史路由）→ session-ui 四级查找链渲染。

**Tech Stack:** TypeScript (CJS gateway / ESM session-ui+desktop / node --test TUI)，jest（gateway）、bun test（session-ui/desktop）、node --test（TUI）。

**Spec:** `docs/superpowers/specs/2026-10-20-runtime-unification-batch-design.md`（rev2，commit f4431b7f）

## Global Constraints

- `part.tool` 永不改写（审批/obs/对账用原生名）；`part.canonicalTool`/`part.toolClass` 只做 additive 注入
- payload 字段契约只 warn 不硬挡（类型白名单硬挡、字段软警告）
- 翻译失败（抛错/非法输出/未命中）一律 fail-open：drop 单事件 + 计数，绝不打断事件流迭代
- 词汇单源：`gateway/src/runtime/mafw-vocabulary.ts`（`MAFW`/`MAFW_RUNTIME_EVENT_NAMES`）↔ SDK `events.ts` 交叉测试钉扎，identity 行是派生物，禁止手抄第二份名单
- 别名准入 = 形状兼容（调研 §2.2 矩阵）；read 域三套键（`filePath`/`path`/`file_path`）由消费侧多 key 链消化
- gateway 测试命令：workdir `gateway`，`npx jest <file> --silent`；session-ui：workdir `packages/session-ui`，`bun test <file>`；TUI：workdir `packages/tui`，`node --test tests/<file>`
- 每任务一个 commit，直接 main，TDD（先测失败再实现）

---

### Task 1: canonicalIdentity 恒等行 + opencode 注册扩容（B1 前置）

**Files:**
- Modify: `gateway/src/runtime/event-mapper.ts`（新增 import + `RUNTIME_IDENTITY_TYPES` + `canonicalIdentity()`）
- Modify: `gateway/src/runtime/opencode-events.ts`（OPENCODE_EVENT_MAPPINGS 追加 identity 行）
- Test: `gateway/tests/unit/runtime/opencode-events.test.ts`

**Interfaces:**
- Produces: `canonicalIdentity(passProperties?: string): EventMapping[]`、`RUNTIME_IDENTITY_TYPES: readonly string[]`（后续任务与 opencode-events.ts 依赖）

- [ ] **Step 1: 写失败测试**（`opencode-events.test.ts` 追加；`ENTRY` 沿用文件顶部既有定义）

```typescript
import { canonicalIdentity, RUNTIME_IDENTITY_TYPES } from '../../../src/runtime/event-mapper';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';
import { TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';

describe('canonicalIdentity 恒等行（B1 identity 声明）', () => {
  it('词汇完备性：runtime 事件词汇 ∪ 工具三原语 逐类型经 opencode 注册面全部命中', () => {
    expect([...RUNTIME_IDENTITY_TYPES]).toEqual(expect.arrayContaining([...MAFW_RUNTIME_EVENT_NAMES]));
    for (const t of ['tool.call', 'tool.delta', 'tool.result']) expect(RUNTIME_IDENTITY_TYPES).toContain(t);
    for (const t of RUNTIME_IDENTITY_TYPES) {
      const out = applyEventMappings(raw(t, { sessionID: 's1', keep: { deep: 1 } }), ENTRY, isCanonical);
      expect(out).toHaveLength(1);
      expect(out[0].payload.type).toBe(t);
      expect(out[0].payload.properties.keep).toEqual({ deep: 1 }); // passProperties 恒等重建
      expect(out[0].sessionID).toBe('s1');
    }
  });

  it('identity 行是词汇单源派生：canonicalIdentity() 逐条 from===to', () => {
    for (const m of canonicalIdentity('$.payload.properties')) {
      expect(m.from).toBe(m.to);
      expect(m.passProperties).toBe('$.payload.properties');
    }
    expect(canonicalIdentity().every((m) => m.passProperties === undefined)).toBe(true);
  });
});
```

同时改写既有测试 `同名收编词经 canonical passthrough 机制通过（不进差异行）`（:41-46）——identity 行命中后输出是**重建信封**而非原对象：

```typescript
  it('同名收编词经 identity 行放行（恒等翻译，载荷 passProperties 重建）', () => {
    for (const t of ['session.created', 'message.updated', 'permission.asked', 'question.asked', 'session.diff']) {
      const out = applyEventMappings(raw(t, { sessionID: 's1', keep: 1 }), ENTRY, isCanonical);
      expect(out).toHaveLength(1);
      expect(out[0].payload.type).toBe(t);
      expect(out[0].payload.properties.keep).toBe(1);
      expect(out[0].sessionID).toBe('s1');
    }
  });
```

及 `差异行不劫持 canonical 直发…`（:61-64）：

```typescript
  it('差异行不劫持 identity：opencode 直接发 canonical 词走恒等行', () => {
    const out = applyEventMappings(raw('turn.completed', { sessionID: 's1' }), ENTRY, isCanonical);
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe('turn.completed');
    expect(out[0].payload.properties.sessionID).toBe('s1');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/opencode-events.test.ts --silent`（workdir `gateway`）
Expected: FAIL —— `canonicalIdentity`/`RUNTIME_IDENTITY_TYPES` not exported；identity 断言不通过（当前同名词走 canonical 直发返回原对象）

- [ ] **Step 3: 实现**

`event-mapper.ts` 顶部（`import { getPath, ... } from './path-expr';` 之后）加：

```typescript
import { MAFW_RUNTIME_EVENT_NAMES } from './mafw-vocabulary';
import { TOOL_PRIMITIVE_TYPES } from './tool-part-assembler';
```

（`tool-part-assembler` 只 import `crypto`/`normalize`/`mafw-vocabulary`，无环。）

`EventMapping` 接口之后加：

```typescript
/** 入口恒等翻译词汇：runtime 契约事件面（= SDK RUNTIME_EVENT_TYPES）∪ 工具三原语。 */
export const RUNTIME_IDENTITY_TYPES: readonly string[] = [
  ...MAFW_RUNTIME_EVENT_NAMES,
  ...TOOL_PRIMITIVE_TYPES,
];

/**
 * 词汇单源派生的恒等翻译行（B1 identity 声明）。
 * 恒等行 = 「该类型已注册翻译，翻译是恒等」——default-deny 下同名事件经此放行；
 * 词汇表加新类型自动覆盖（契约内类型即放行），runtime 私货类型被拦逼显式注册。
 * passProperties 传 runtime 信封的 properties 路径（opencode '$.payload.properties'）。
 */
export function canonicalIdentity(passProperties?: string): EventMapping[] {
  return RUNTIME_IDENTITY_TYPES.map((t) => ({
    from: t,
    to: t,
    ...(passProperties ? { passProperties } : {}),
  }));
}
```

`opencode-events.ts` 的 `OPENCODE_EVENT_MAPPINGS` 末尾追加（import 区加 `canonicalIdentity`）：

```typescript
import { canonicalIdentity, type EventMapping, type EventSourceShape, type TransformEventFn } from './event-mapper';

export const OPENCODE_EVENT_MAPPINGS: EventMapping[] = [
  // ---- 回合终态三元组（v2 语义修正：五终态双轨合并） ----
  { from: 'session.idle', to: 'turn.completed', passProperties: '$.payload.properties' },
  // …（现有 8 行差异不动）…
  { from: 'todo.updated', to: 'plan.updated', passProperties: '$.payload.properties' },
  // ---- canonical identity（词汇单源派生，B1：同名收编词的显式注册） ----
  ...canonicalIdentity('$.payload.properties'),
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/runtime/opencode-events.test.ts tests/unit/runtime/event-replay.test.ts --silent`
Expected: PASS（event-replay golden 的 `session.updated` 首事件现经 identity 行，输出重建信封——`payload.type`/`sessionID`/`directory` 断言不变）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-mapper.ts gateway/src/runtime/opencode-events.ts gateway/tests/unit/runtime/opencode-events.test.ts
git commit -m "feat(runtime): canonicalIdentity 词汇单源恒等行——opencode 同名收编词显式注册（B1 前置，canonical 直发分支的取代面）"
```

---

### Task 2: 入口执法链——删 canonical 直发、信封分流、hooks（B1 核心）

**Files:**
- Modify: `gateway/src/runtime/event-mapper.ts`（`applyEventMappings` 链改造 + `TranslationHooks` + `wrapGlobalEventStream` 签名）
- Modify: `gateway/src/index.ts`（createRuntime 三处 wrap 调用点 :1334/:1369/:1382）
- Test: `gateway/tests/unit/runtime/event-mapper.test.ts`、`gateway/tests/unit/runtime/loader-event-mappings.test.ts`

**Interfaces:**
- Consumes: Task 1 的 identity 行（opencode 同名词继续放行）
- Produces: `TranslationHooks { onUnmatched?(type), onSuppressed?(type), onTranslationError?(raw, reason) }`；`applyEventMappings(raw, entry, isCanonicalType, hooks?)`（第 4 参从 onUnknown 函数改为 hooks 对象，**破坏性**）；`wrapGlobalEventStream(rt, entry, isCanonicalType, hooks?: TranslationHooks & { onNoMappings?: () => void })`

- [ ] **Step 1: 写失败测试**（`event-mapper.test.ts` 改写三处 + 新增一处）

改写 `drop + 未命中 canonical passthrough + 未知丢弃并遥测`（:53-62）：

```typescript
test('drop 行计 suppressed；canonical 形状未注册 → 拦截（default-deny）；未知 → 拦截 + onUnmatched', () => {
  const suppressed: string[] = [];
  expect(applyEventMappings({ type: 'queue_update', sessionID: 's1' }, PI, isCanonical, { onSuppressed: (t) => suppressed.push(t) })).toEqual([]);
  expect(suppressed).toEqual(['queue_update']);
  // default-deny：canonical 形状但无注册翻译（PI 无 identity 行）→ 不再透传
  const unmatched: string[] = [];
  expect(applyEventMappings({ type: 'turn.completed', properties: { sessionID: 's1' } }, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) })).toEqual([]);
  expect(applyEventMappings({ type: 'mystery' }, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) })).toEqual([]);
  expect(unmatched).toEqual(['turn.completed', 'mystery']);
});
```

改写 `无 top-level type（已 canonical 信封）→ 原样 passthrough`（:76-79）：

```typescript
test('信封形态：canonical 类型放行（pi 已翻译流）；未知类型入口拦截；畸形透传给下游诊断', () => {
  const pushed = { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r1' } } };
  expect(applyEventMappings(pushed, PI, isCanonical)).toEqual([pushed]);
  const bad = { payload: { type: 'not.a.type', properties: {} } };
  const unmatched: string[] = [];
  expect(applyEventMappings(bad, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) })).toEqual([]);
  expect(unmatched).toEqual(['not.a.type']);
  const malformed = { foo: 1 };
  expect(applyEventMappings(malformed, PI, isCanonical)).toEqual([malformed]);
});
```

改写 `transformEvent 逃逸口`（:64-74）——null 补 suppressed 断言：

```typescript
test('transformEvent 逃逸口：未匹配时调用；null=suppressed 丢弃，数组=扇出', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [],
    transformEvent: (raw: any) => raw.type === 'fan'
      ? [{ payload: { type: 'session.idle', properties: {} } }]
      : null,
  };
  const suppressed: string[] = [];
  expect(applyEventMappings({ type: 'other' }, entry, isCanonical, { onSuppressed: (t) => suppressed.push(t) })).toEqual([]);
  expect(suppressed).toEqual(['other']);
  expect(applyEventMappings({ type: 'fan' }, entry, isCanonical)).toHaveLength(1);
});
```

`loader-event-mappings.test.ts` 的 wrapGlobalEventStream 端到端（:48-51）调用改 hooks 形态：

```typescript
  wrapGlobalEventStream(rt, {
    eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
    eventMappings: [{ from: 'done', to: 'session.idle' }, { from: 'noise', to: 'drop' }],
  }, (t) => mini.has(t), { onUnmatched: (t) => unknown.push(t) });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/event-mapper.test.ts tests/unit/runtime/loader-event-mappings.test.ts --silent`
Expected: FAIL（类型不匹配 / passthrough 断言失败）

- [ ] **Step 3: 实现 event-mapper.ts**

`TransformEventFn` 定义之后加：

```typescript
export interface TranslationHooks {
  /** 未命中任何注册翻译（词汇漂移/漏声明——监控信号，进 unmatched 计数）。 */
  onUnmatched?: (type: string) => void;
  /** 声明式压制：drop 行命中 / transformEvent 显式返回 null（作者意图，单独计）。 */
  onSuppressed?: (type: string) => void;
  /** transformEvent 抛错或输出非法形状（B2 守卫接入）。 */
  onTranslationError?: (raw: any, reason: string) => void;
}
```

`applyEventMappings` 整体替换（签名第 4 参 `onUnknown?` → `hooks?`）：

```typescript
export function applyEventMappings(
  raw: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  hooks?: TranslationHooks,
): any[] {
  const source = entry.eventSource;
  const nativeType: unknown = source ? getPath(raw, source.typePath) : undefined;
  if (typeof nativeType !== 'string' || !nativeType) {
    // typePath 不可解析：信封形态（pi 已翻译流）或畸形事件。
    // 信封 canonical（含工具三原语）→ 放行（已声明翻译的产物）；未知类型 → 入口拦截；
    // 畸形（无可解析类型）→ 原样透传给下游畸形诊断（isMalformedEvent）。
    const envelopeType = typeof raw?.payload?.type === 'string' ? raw.payload.type : '';
    if (!envelopeType) return [raw];
    if (isCanonicalType(envelopeType)) return [raw];
    hooks?.onUnmatched?.(envelopeType);
    return [];
  }

  const sidPaths = !source?.sessionIdPath
    ? []
    : Array.isArray(source.sessionIdPath) ? source.sessionIdPath : [source.sessionIdPath];
  const sessionID = sidPaths.map((p) => getPath(raw, p)).find((v) => v) as string | undefined;
  const directory = source?.directoryPath ? getPath(raw, source.directoryPath) : undefined;

  for (const m of entry.eventMappings ?? []) {
    const froms = Array.isArray(m.from) ? m.from : [m.from];
    if (!froms.includes(nativeType)) continue;
    if (!evalConditions(m.when, raw)) continue;
    if (m.to === 'drop') {
      hooks?.onSuppressed?.(nativeType);
      return [];
    }
    let properties: Record<string, any> = {};
    if (m.passProperties) {
      const src = getPath(raw, m.passProperties);
      if (src && typeof src === 'object') {
        // 深拷贝防 aliasing：输出事件与 raw 输入不共享可变子树。
        properties = JSON.parse(JSON.stringify(src)) as Record<string, any>;
      }
    }
    for (const [key, fv] of Object.entries(m.fields ?? {})) {
      const v = evalField(fv, raw);
      if (v !== undefined) setPath(properties, key, v);
    }
    if (typeof sessionID === 'string' && sessionID) {
      if (SESSION_ID_TARGETS[m.to] === 'part') {
        if (properties.part && properties.part.sessionID === undefined) properties.part.sessionID = sessionID;
      } else if (properties.sessionID === undefined) {
        properties.sessionID = sessionID;
      }
    }
    return [{ payload: { type: m.to, properties }, sessionID: sessionID as any, directory: directory as any }];
  }

  // canonical 直发分支已删除（B1 default-deny）：同名收编经 canonicalIdentity() 恒等行。
  if (entry.transformEvent) {
    const out = entry.transformEvent(raw);
    if (out === null || out === undefined) {
      hooks?.onSuppressed?.(nativeType);
      return [];
    }
    return Array.isArray(out) ? out : [out];
  }

  hooks?.onUnmatched?.(nativeType);
  return [];
}
```

`wrapGlobalEventStream` 替换（hooks 并入第 4 参）：

```typescript
export function wrapGlobalEventStream(
  rt: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  hooks?: TranslationHooks & { onNoMappings?: () => void },
): void {
  const hasDeclarations = (entry.eventMappings?.length ?? 0) > 0 || !!entry.transformEvent;
  if (!hasDeclarations) hooks?.onNoMappings?.();
  const orig = rt.global.event.bind(rt.global);
  rt.global.event = async () => {
    const result = await orig();
    const stream = result?.stream ?? result;
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return result;
    const mapped = (async function* () {
      for await (const raw of stream) {
        for (const evt of applyEventMappings(raw, entry, isCanonicalType, hooks)) yield evt;
      }
    })();
    return result?.stream ? { ...result, stream: mapped } : mapped;
  };
}
```

文件头注释的匹配优先级行更新为：`eventMappings（数组序，含 identity/drop 行）→ transformEvent → 拦截+计数（default-deny）`。

- [ ] **Step 4: 更新 index.ts 三处调用点**（:1334 插件分支、:1369 builtin 分支、:1382 direct 分支——统一形态，插件分支示例）：

```typescript
          wrapGlobalEventStream(rt, plugin, (t) => CANONICAL_TYPE_SET.has(t), {
            onUnmatched: (t) => {
              try {
                const { firstSeen } = this.unknownEventTracker.record(rt.name, t);
                if (firstSeen) {
                  log.warn(
                    `[SSE] runtime '${rt.name}' native event '${t}' unmapped — dropped ` +
                    `(declare it in eventMappings or handle via transformEvent)`,
                  );
                }
              } catch { /* fail-open */ }
            },
            onNoMappings: () => {
              log.warn(
                `[Runtime] '${rt.name}' declares no event mappings/transformEvent — ` +
                `native stream passes through untranslated (OK only for canonical-identity runtimes)`,
              );
            },
          });
```

builtin/direct 分支同形态（runtime 名 'opencode'，无 onNoMappings——builtin 恒有声明）。

- [ ] **Step 5: 跑测试确认通过 + 邻近回归**

Run: `npx jest tests/unit/runtime/ --silent`（workdir `gateway`）
Expected: PASS 全绿（含 opencode-events / event-replay / pi-events / normalize-oracle——pi 信封路径由 envelope-canonical 分支保持）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/event-mapper.ts gateway/src/index.ts gateway/tests/unit/runtime/event-mapper.test.ts gateway/tests/unit/runtime/loader-event-mappings.test.ts
git commit -m "feat(runtime): 事件入口 default-deny——canonical 直发分支删除，信封分流（canonical 放行/未知拦截/畸形透传），TranslationHooks(unmatched/suppressed) 取代 onUnknown"
```

---

### Task 3: opencode transformEvent 退役（session.next.*/sync drop 行表化，B1 完成）

**Files:**
- Modify: `gateway/src/runtime/opencode-events.ts`（删 `opencodeTransformEvent`，加 drop 行）
- Modify: `gateway/src/index.ts`（两处注册 extras :555/:1385 删 transformEvent 字段 + 顶部 import 清理）
- Test: `gateway/tests/unit/runtime/opencode-events.test.ts`、`gateway/tests/unit/runtime/event-replay.test.ts`

**Interfaces:**
- Produces: `OPENCODE_EVENT_MAPPINGS` 含显式 drop 行；`opencodeTransformEvent` **删除**（导出面移除）

- [ ] **Step 1: 写失败测试**（`opencode-events.test.ts` 改写 :48-59 两测 + ENTRY 去 transformEvent）

```typescript
const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
};

it('session.next.* legacy 族经显式 drop 行丢弃（词汇外新成员同样被拦——default-deny 漏网探测器）', () => {
  for (const t of [
    'session.next.step.ended', 'session.next.reasoning.ended',
    'session.next.tool.started', 'session.next.tool.updated', 'session.next.tool.ended', 'session.next.tool.failed',
  ]) {
    const suppressed: string[] = [];
    expect(applyEventMappings(raw(t, { sessionID: 's1' }), ENTRY, isCanonical, { onSuppressed: (x) => suppressed.push(x) })).toEqual([]);
    expect(suppressed).toEqual([t]);
  }
  // 家族新成员（未来 opencode 新增）→ unmatched 拦截 + 计数，不再静默穿过
  const unmatched: string[] = [];
  expect(applyEventMappings(raw('session.next.tool.created', {}), ENTRY, isCanonical, { onUnmatched: (x) => unmatched.push(x) })).toEqual([]);
  expect(unmatched).toEqual(['session.next.tool.created']);
});

it('sync 信封经 drop 行丢弃', () => {
  const suppressed: string[] = [];
  expect(applyEventMappings(raw('sync', { seq: 1 }), ENTRY, isCanonical, { onSuppressed: (x) => suppressed.push(x) })).toEqual([]);
  expect(suppressed).toEqual(['sync']);
});

it('词汇外新词（未来 opencode 事件）→ unmatched 拦截 + 计数（不再 transformEvent 返 raw 穿过）', () => {
  const unmatched: string[] = [];
  expect(applyEventMappings(raw('session.forked', { sessionID: 's1' }), ENTRY, isCanonical, { onUnmatched: (x) => unmatched.push(x) })).toEqual([]);
  expect(unmatched).toEqual(['session.forked']);
});
```

`event-replay.test.ts`：`OC_ENTRY` 删 `transformEvent: opencodeTransformEvent` 行 + import 清理；`session.next.* legacy family` 测试（:38-45）断言不变（drop 行同产出 `[]`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/opencode-events.test.ts tests/unit/runtime/event-replay.test.ts --silent`
Expected: FAIL（transformEvent 返 raw 让新词穿过 / ENTRY 类型缺字段）

- [ ] **Step 3: 实现**

`opencode-events.ts`：`OPENCODE_EVENT_MAPPINGS` 差异行后、identity 行前插：

```typescript
  // ---- legacy 族 + sync 信封：显式 drop 行（原 transformEvent 前缀丢弃的表化，B1） ----
  ...([
    'session.next.step.ended', 'session.next.reasoning.ended',
    'session.next.tool.started', 'session.next.tool.updated',
    'session.next.tool.ended', 'session.next.tool.failed',
    'sync',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
```

删除 `opencodeTransformEvent` 整段（:45-49）及其类型 import；文件头注释相应更新（前缀丢弃 → drop 行表化）。

`index.ts`：两处注册（:552-556 registerBuiltin extras、:1382-1385 direct 分支）删 `transformEvent: opencodeTransformEvent` 行；顶部 import 删 `opencodeTransformEvent`（grep 定位）。

- [ ] **Step 4: 跑测试确认通过 + 邻近回归**

Run: `npx jest tests/unit/runtime/ --silent`
Expected: PASS 全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/opencode-events.ts gateway/src/index.ts gateway/tests/unit/runtime/opencode-events.test.ts gateway/tests/unit/runtime/event-replay.test.ts
git commit -m "feat(runtime): opencode transformEvent 退役——session.next.*/sync 显式 drop 行表化，词汇外新词 unmatched 拦截（B1 对 opencode 完全生效）"
```

---

### Task 4: 无声明加载期降级 + pi audit + loader README（B1 配套）

**Files:**
- Modify: `gateway/src/runtime/event-mapper.ts`（`hasEventDeclarations`）
- Modify: `gateway/src/runtime/loader.ts`（loadFile 无声明降级 + README_CONTENT 语义更新）
- Modify: `gateway/src/index.ts`（插件分支 activate 后兜底降级——覆盖包贡献 runtime）
- Test: `gateway/tests/unit/runtime/loader-event-mappings.test.ts`、`gateway/tests/unit/runtime/pi-events.test.ts`（audit 追加）

**Interfaces:**
- Produces: `hasEventDeclarations(entry: EventMappingEntry): boolean`（Task 10 复用）

- [ ] **Step 1: 写失败测试**

`loader-event-mappings.test.ts` 追加：

```typescript
test('无声明 runtime：eventStream 能力降级 + error 状态（default-deny 前置）', async () => {
  const dir = makePluginDir({
    'bare.js': `module.exports = { name: 'bare', capabilities: { eventStream: true },
      async createRuntime() { return { name: 'bare', capabilities: { eventStream: true } }; } };`,
  });
  const loader = new RuntimePluginLoader(dir);
  loader.setCanonicalTypes(CANON);
  await loader.scan();
  expect(loader.get('bare')?.capabilities.eventStream).toBe(false); // 降级
  const state = loader.getState().find((s) => s.name === 'bare');
  expect(state?.status).toBe('error');
  expect(state?.error).toContain('no eventMappings');
});
```

`pi-events.test.ts` 追加 audit：

```typescript
import { hasEventDeclarations } from '../../../src/runtime/event-mapper';

describe('pi 事件翻译覆盖 audit（B1）', () => {
  it('pi 注册面有声明；已知原生类型要么映射要么显式经 transformEvent 处理，不依赖 canonical 直发', () => {
    const entry = { eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent };
    expect(hasEventDeclarations(entry)).toBe(true);
    // pi 原生名均非 canonical（translatePiEvent 的 isCanonical 恒 false）——不存在直发依赖
    const mapped = new Set(PI_EVENT_MAPPINGS.flatMap((m) => (Array.isArray(m.from) ? m.from : [m.from])));
    for (const t of ['agent_start', 'message_start', 'message_update', 'message_end', 'tool_call', 'tool_result', 'turn_start', 'turn_end', 'agent_end', 'agent_settled']) {
      expect(mapped.has(t)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/loader-event-mappings.test.ts tests/unit/runtime/pi-events.test.ts --silent`
Expected: FAIL（`hasEventDeclarations` 未导出；bare 插件 eventStream 仍 true）

- [ ] **Step 3: 实现**

`event-mapper.ts`（`wrapGlobalEventStream` 前）：

```typescript
/** 是否携带任何翻译声明（映射行或 transformEvent）——无声明 runtime 在 default-deny 下原生流全灭。 */
export function hasEventDeclarations(entry: EventMappingEntry): boolean {
  return (entry.eventMappings?.length ?? 0) > 0 || !!entry.transformEvent;
}
```

`loader.ts` `loadFile` 内 `mappingIssues` 计算之后、`if (mappingIssues.length > 0)` 之前插入：

```typescript
      // B1 default-deny 前置：声明 eventStream 却无任何翻译声明 → 原生流会被整条拦截，
      // 与其静默全灭不如加载期降级（声明翻译行或 canonicalIdentity() 恒等行后再开）。
      if (capabilities.eventStream && !hasEventDeclarations(eventExtras)) {
        capabilities.eventStream = false;
        mappingIssues.push('eventStream capability declared but no eventMappings/transformEvent — default-deny would drop the entire native stream; capability downgraded (declare translations or identity rows via canonicalIdentity())');
      }
```

import 行加 `hasEventDeclarations`（来自 `./event-mapper`）。

README_CONTENT 尾部 "Match priority" 段替换为：

```
Match priority: eventMappings (array order — includes `drop` rows and
`canonicalIdentity()`-derived identity rows) → transformEvent (guarded) →
dropped + unmatched counter. There is NO canonical passthrough branch: a
runtime emitting same-named canonical events registers identity rows via
canonicalIdentity('$.payload.properties') (vocabulary single source).
Load-time validation rejects unknown canonical targets / malformed paths /
eventStream-without-declarations (plugin's eventStream capability degrades,
fail-open). Drop counters: GET /api/runtime .translationDrops (unmatched =
monitoring signal; suppressed = declared drop / transformEvent null).
```

`index.ts` 插件分支（:1329 `applyRuntimeValidation` 之后、wrapGlobalEventStream 之前）：

```typescript
          // 包贡献 runtime 不经 loader.loadFile 的无声明降级——此处兜底（B1 D2）
          if ((rt.capabilities as any)?.eventStream && !hasEventDeclarations(plugin)) {
            (rt.capabilities as any).eventStream = false;
            log.error(`[Runtime] '${rt.name}' declares no event translations — eventStream downgraded (default-deny would drop the entire native stream)`);
          }
```

import 区加 `hasEventDeclarations`（与 `wrapGlobalEventStream` 同源）。

- [ ] **Step 4: 跑测试确认通过 + loader 全量**

Run: `npx jest tests/unit/runtime/loader --silent`
Expected: PASS（含 loader.test/loader-builtin/loader-alias 既有用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-mapper.ts gateway/src/runtime/loader.ts gateway/src/index.ts gateway/tests/unit/runtime/loader-event-mappings.test.ts gateway/tests/unit/runtime/pi-events.test.ts
git commit -m "feat(runtime): 无声明 runtime eventStream 加载期降级（default-deny 前置）+ pi 覆盖 audit + loader README 语义更新"
```

---

### Task 5: B2 执行守卫——transformEvent try/catch + 输出校验 + 类型收紧；normalizeMessages 守卫；translationErrors 暴露；conformance 历史断言

**Files:**
- Modify: `gateway/src/runtime/event-mapper.ts`（transformEvent 块守卫 + `TransformEventFn` 类型）
- Modify: `gateway/src/runtime/normalize-messages.ts`（`applyNormalizeMessages` 输出守卫 + `wrapRuntimeMessages` 透传回调）
- Modify: `gateway/src/index.ts`（translationErrors 字段/记录/接线/wrapRuntimeIdentity/handleRuntimeGet deps）
- Modify: `gateway/src/routes/runtime-switch.ts`（handleRuntimeGet 响应 + deps Pick）
- Modify: `gateway/src/routes/conformance.ts` + `gateway/src/runtime/conformance-scenarios.ts`（getMessages + 历史形状断言）
- Test: `gateway/tests/unit/runtime/event-mapper.test.ts`、`gateway/tests/unit/runtime/normalize-messages-route.test.ts`、`gateway/tests/unit/routes/runtime-get.test.ts`、`gateway/tests/unit/runtime/conformance-scenarios.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `TranslationHooks.onTranslationError`
- Produces: `TransformEventFn = (raw: any) => RawRuntimeEvent | RawRuntimeEvent[] | null | undefined`；`applyNormalizeMessages(runtime, rawData, onViolation?)`；`/api/runtime` 响应新增 `translationErrors: Record<runtime, {transformEvent, normalizeMessages, lastError?, lastAt?}>`

- [ ] **Step 1: 写失败测试**

`event-mapper.test.ts` 追加：

```typescript
describe('B2 transformEvent 守卫', () => {
  const entry = (fn: any): EventMappingEntry => ({ eventSource: { typePath: '$.type' }, eventMappings: [], transformEvent: fn });

  test('抛错 → drop + onTranslationError，不断流', () => {
    const errs: string[] = [];
    const out = applyEventMappings({ type: 'x' }, entry(() => { throw new Error('boom'); }), isCanonical, { onTranslationError: (_r, reason) => errs.push(reason) });
    expect(out).toEqual([]);
    expect(errs[0]).toContain('boom');
  });

  test('返回字符串（非法形状）→ drop + onTranslationError', () => {
    const errs: string[] = [];
    expect(applyEventMappings({ type: 'x' }, entry(() => 'garbage'), isCanonical, { onTranslationError: (_r, reason) => errs.push(reason) })).toEqual([]);
    expect(errs[0]).toContain('malformed');
  });

  test('数组含非对象成员 → drop + onTranslationError', () => {
    const errs: string[] = [];
    expect(applyEventMappings({ type: 'x' }, entry(() => [{ payload: { type: 'ok', properties: {} } }, 42]), isCanonical, { onTranslationError: (_r, reason) => errs.push(reason) })).toEqual([]);
    expect(errs).toHaveLength(1);
  });

  test('合法输出（裸事件/信封/数组）照常通过', () => {
    expect(applyEventMappings({ type: 'x' }, entry(() => ({ type: 'session.idle' })), isCanonical)).toHaveLength(1);
    expect(applyEventMappings({ type: 'x' }, entry(() => [{ payload: { type: 'session.idle', properties: {} } }]), isCanonical)).toHaveLength(1);
  });
});
```

`normalize-messages-route.test.ts` 追加：

```typescript
describe('B2 normalizeMessages 输出守卫', () => {
  test('返回非数组 → onViolation + 回退原文', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => 'nope' } } as any;
    const violations: string[] = [];
    expect(applyNormalizeMessages(rt, raw, (r) => violations.push(r))).toBe(raw);
    expect(violations[0]).toContain('non-array');
  });

  test('返回缺 parts 数组的成员 → onViolation + 回退原文', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => [{ info: {}, parts: 'x' }] } } as any;
    const violations: string[] = [];
    expect(applyNormalizeMessages(rt, raw, (r) => violations.push(r))).toBe(raw);
    expect(violations[0]).toContain('info, parts[]');
  });

  test('wrapRuntimeMessages 透传 onViolation', async () => {
    const rt = {
      session: {
        normalizeMessages: () => { throw new Error('bad'); },
        messages: async () => ({ data: [{ id: 'm1' }] }),
      },
    } as any;
    const violations: string[] = [];
    wrapRuntimeMessages(rt, (r) => violations.push(r));
    const out = await rt.session.messages({});
    expect(out.data).toEqual([{ id: 'm1' }]);
    expect(violations[0]).toContain('bad');
  });
});
```

`runtime-get.test.ts` 追加（沿用该文件既有 deps 构造模式）：deps 增 `translationErrors: () => ({ pi: { transformEvent: 2, normalizeMessages: 0, lastError: 'boom', lastAt: 't' } })` → 响应 JSON 断言 `translationErrors.pi.transformEvent === 2`。

`conformance-scenarios.test.ts` 追加：

```typescript
test('session-lifecycle：历史形状断言（{info,parts[]}）', () => {
  const ok = evaluateScenario('session-lifecycle', [], { created: true, deleted: true, history: [{ info: { id: 'm1' }, parts: [] }] });
  expect(ok.pass).toBe(true);
  const bad = evaluateScenario('session-lifecycle', [], { created: true, deleted: true, history: [{ info: {} }] });
  expect(bad.failures.some((f) => f.includes('history'))).toBe(true);
  const none = evaluateScenario('session-lifecycle', [], { created: true, deleted: true, history: null });
  expect(none.pass).toBe(true); // getMessages 失败不判死（fail-open）
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/event-mapper.test.ts tests/unit/runtime/normalize-messages-route.test.ts tests/unit/routes/runtime-get.test.ts tests/unit/runtime/conformance-scenarios.test.ts --silent`
Expected: FAIL

- [ ] **Step 3: 实现**

`event-mapper.ts`：import 区加 `import type { RawRuntimeEvent } from './normalize';`（normalize 不依赖 event-mapper，无环）。类型替换：

```typescript
export type TransformEventFn = (raw: any) => RawRuntimeEvent | RawRuntimeEvent[] | null | undefined;
```

`applyEventMappings` 的 transformEvent 块替换为守卫版：

```typescript
  if (entry.transformEvent) {
    let out: unknown;
    try {
      out = entry.transformEvent(raw);
    } catch (err: any) {
      hooks?.onTranslationError?.(raw, `transformEvent threw: ${err?.message ?? String(err)}`);
      return [];
    }
    if (out === null || out === undefined) {
      hooks?.onSuppressed?.(nativeType);
      return [];
    }
    const arr = Array.isArray(out) ? out : [out];
    const ok = arr.every((e: any) =>
      e && typeof e === 'object' && typeof (e.payload?.type ?? e.type) === 'string' && !!(e.payload?.type ?? e.type));
    if (!ok) {
      hooks?.onTranslationError?.(raw, 'transformEvent returned malformed event(s) — expected {payload:{type,...}}/{type,...} objects, null, or array thereof');
      return [];
    }
    return arr as any[];
  }
```

`normalize-messages.ts` 整体替换：

```typescript
/**
 * session.messages 历史 DTO 归一：runtime 声明 normalizeMessages 则应用，否则恒等。
 * B2 输出守卫：非数组 / 成员缺 parts 数组 / 抛错 → onViolation + 回退原文（历史可用性不破坏）。
 */
export function applyNormalizeMessages(
  runtime: any,
  rawData: any[],
  onViolation?: (reason: string) => void,
): any[] {
  const fn = runtime?.session?.normalizeMessages;
  if (typeof fn !== 'function') return rawData;
  try {
    const out = fn.call(runtime.session, rawData);
    if (!Array.isArray(out)) {
      onViolation?.('normalizeMessages returned non-array — falling back to raw data');
      return rawData;
    }
    if (!out.every((m: any) => m && typeof m === 'object' && Array.isArray(m.parts))) {
      onViolation?.('normalizeMessages returned non-{info,parts[]} shapes — falling back to raw data');
      return rawData;
    }
    return out;
  } catch (err: any) {
    onViolation?.(`normalizeMessages threw: ${err?.message ?? String(err)}`);
    return rawData;
  }
}

/**
 * 收口 runtime.session.messages：声明了 normalizeMessages 的 runtime，其历史数据
 * 在出口处统一归一为 opencode {info, parts} DTO。幂等（重复调用不再包）。
 */
export function wrapRuntimeMessages(rt: any, onViolation?: (reason: string) => void): void {
  const session = rt?.session;
  if (!session || typeof session.messages !== 'function') return;
  if (typeof session.normalizeMessages !== 'function') return;
  if (session.__mafwMessagesWrapped) return;
  const orig = session.messages.bind(session);
  session.messages = async (opts: any) => {
    const result = await orig(opts);
    const data = result?.data;
    if (!Array.isArray(data)) return result;
    return { ...result, data: applyNormalizeMessages(rt, data, onViolation) };
  };
  session.__mafwMessagesWrapped = true;
}
```

`index.ts`：Scheduler 字段区（`unknownEventTracker` 旁）加：

```typescript
  private translationErrors = new Map<string, { transformEvent: number; normalizeMessages: number; lastError?: string; lastAt?: string; lastWarnAt?: number }>();

  /** B2 守卫失败记录：限频 ERROR（30s per-runtime，isMalformedEvent 同模式）+ 计数。 */
  private recordTranslationError(runtime: string, kind: 'transformEvent' | 'normalizeMessages', reason: string): void {
    try {
      const now = Date.now();
      const cur = this.translationErrors.get(runtime) ?? { transformEvent: 0, normalizeMessages: 0 };
      cur[kind]++;
      cur.lastError = reason;
      cur.lastAt = new Date().toISOString();
      if (!cur.lastWarnAt || now - cur.lastWarnAt > 30_000) {
        cur.lastWarnAt = now;
        log.error(`[Runtime] translation error (${runtime}.${kind}): ${reason}`);
      }
      this.translationErrors.set(runtime, cur);
    } catch { /* fail-open */ }
  }
```

三处 wrapGlobalEventStream hooks 各加一行：`onTranslationError: (_raw, reason) => this.recordTranslationError(rt.name, 'transformEvent', reason)`（direct 分支 runtime 名 'opencode'）。`wrapRuntimeIdentity` 内 `wrapRuntimeMessages(rt)` 改：

```typescript
    wrapRuntimeMessages(rt, (reason) => this.recordTranslationError(rt.name, 'normalizeMessages', reason));
```

runtime 切换清空：switch deps `onSwitched` 闭包内（`resubscribeEvents` 调用前后均可）加 `this.translationErrors.clear();`。

`runtime-switch.ts`：`RuntimeSwitchDeps` 增 `translationErrors?: () => Record<string, unknown>`；`handleRuntimeGet` 的 Pick 增 `'translationErrors'`，响应对象增 `translationErrors: deps.translationErrors ? deps.translationErrors() : {}`；index.ts `runtimeSwitchDeps`（:1735 附近 deps 对象）加 `translationErrors: () => Object.fromEntries(this.translationErrors)`。

conformance 历史断言：`ConformanceDeps` 增 `getMessages(sessionID: string): Promise<any[]>`；路由 session-lifecycle 分支（:144-152）create 后加 `const history = await deps.getMessages(sess.id).catch(() => null);`，`evaluateScenario(sc.id, [], { created, deleted, history: history ?? undefined })`；index.ts `conformanceDeps()`（:1648 起）加：

```typescript
      getMessages: async (sessionID) => ((await this.runtime?.session.messages({ sessionID, limit: 5 })) as any)?.data ?? [],
```

`conformance-scenarios.ts`：`evaluateScenario` 的 `apiResult` 参数类型扩为 `{ created: boolean; deleted: boolean; history?: any[] }`，session-lifecycle 分支加：

```typescript
    if (apiResult?.history && !apiResult.history.every((m: any) => m && typeof m === 'object' && Array.isArray(m.parts))) {
      failures.push('history messages are not {info, parts[]} shaped — normalizeMessages output invalid');
    }
```

- [ ] **Step 4: 跑测试确认通过 + tsc**

Run: `npx jest tests/unit/runtime/ tests/unit/routes/runtime-get.test.ts --silent`（workdir `gateway`）；`npx tsc --noEmit`（workdir `gateway`）
Expected: PASS + 类型零错误（piTransformEvent 输出本就合法，预期零改动达标）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-mapper.ts gateway/src/runtime/normalize-messages.ts gateway/src/index.ts gateway/src/routes/runtime-switch.ts gateway/src/routes/conformance.ts gateway/src/runtime/conformance-scenarios.ts gateway/tests/unit/runtime/event-mapper.test.ts gateway/tests/unit/runtime/normalize-messages-route.test.ts gateway/tests/unit/routes/runtime-get.test.ts gateway/tests/unit/runtime/conformance-scenarios.test.ts
git commit -m "feat(runtime): B2 执行守卫——transformEvent try/catch+输出校验+类型收紧（修断流 bug）、normalizeMessages 输出守卫、translationErrors 限频 ERROR+计数+/api/runtime 暴露、conformance 历史形状断言"
```

---

### Task 6: B3 拦截可观测——translationDrops 计数、终态 loud warn、conformance unmatched 断言

**Files:**
- Modify: `gateway/src/index.ts`（translationDrops 字段/记录/hooks 升级/暴露/切换清空）
- Modify: `gateway/src/routes/runtime-switch.ts`（响应字段）
- Modify: `gateway/src/routes/conformance.ts` + `gateway/src/runtime/conformance-scenarios.ts`（drops 差分 + 断言）
- Test: `gateway/tests/unit/routes/runtime-get.test.ts`、`gateway/tests/unit/runtime/conformance-scenarios.test.ts`

**Interfaces:**
- Produces: `/api/runtime` 响应新增 `translationDrops: Record<runtime, { unmatched: Record<type, count>; suppressed: Record<type, count> }>`；`evaluateScenario(id, events, apiResult?, cognition?, identity?, drops?: { unmatched: Record<string, number> })`

- [ ] **Step 1: 写失败测试**

`runtime-get.test.ts` 追加：deps 增 `translationDrops: () => ({ pi: { unmatched: { 'turn.completed': 3 }, suppressed: { sync: 7 } } })` → 响应断言两计数。`conformance-scenarios.test.ts` 追加：

```typescript
test('chat-roundtrip：场景窗口内 unmatched drops > 0 → fail（词汇漂移探测器）', () => {
  const ok = evaluateScenario('chat-roundtrip', [
    { type: 'part.updated', sessionID: 's' },
    { type: 'turn.completed', sessionID: 's' },
  ], undefined, undefined, undefined, { unmatched: {} });
  expect(ok.pass).toBe(true);
  const bad = evaluateScenario('chat-roundtrip', [
    { type: 'part.updated', sessionID: 's' },
    { type: 'turn.completed', sessionID: 's' },
  ], undefined, undefined, undefined, { unmatched: { 'some.future.word': 2 } });
  expect(bad.failures.some((f) => f.includes('unmatched'))).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/routes/runtime-get.test.ts tests/unit/runtime/conformance-scenarios.test.ts --silent`
Expected: FAIL

- [ ] **Step 3: 实现**

`index.ts` Scheduler 加字段与方法：

```typescript
  private translationDrops = new Map<string, { unmatched: Record<string, number>; suppressed: Record<string, number> }>();

  /** B3 入口拦截计数：unmatched（监控信号）/ suppressed（声明式压制）；turn 终态 unmatched 每次 loud warn。 */
  private recordTranslationDrop(runtime: string, type: string, kind: 'unmatched' | 'suppressed'): void {
    try {
      const cur = this.translationDrops.get(runtime) ?? { unmatched: {}, suppressed: {} };
      cur[kind][type] = (cur[kind][type] ?? 0) + 1;
      this.translationDrops.set(runtime, cur);
      if (kind === 'unmatched') {
        if (type === 'turn.completed' || type === 'turn.failed' || type === 'turn.aborted') {
          log.warn(`[SSE] runtime '${runtime}' unmatched TERMINAL event '${type}' — turn pipeline broken (vocabulary drift? update eventMappings); this warns on EVERY occurrence`);
        } else {
          const { firstSeen } = this.unknownEventTracker.record(runtime, type);
          if (firstSeen) {
            log.warn(`[SSE] runtime '${runtime}' unmatched event type '${type}' — dropped (declare in eventMappings/transformEvent); counters: GET /api/runtime .translationDrops`);
          }
        }
      }
    } catch { /* fail-open */ }
  }
```

三处 wrapGlobalEventStream hooks 升级（onUnmatched/onSuppressed 均改走 recordTranslationDrop；onUnmatched 的旧 tracker 逻辑由方法内吸收）：

```typescript
            onUnmatched: (t) => this.recordTranslationDrop(rt.name, t, 'unmatched'),
            onSuppressed: (t) => this.recordTranslationDrop(rt.name, t, 'suppressed'),
```

（direct 分支 runtime 名 'opencode'。）switch `onSwitched` 清空行扩为 `this.translationErrors.clear(); this.translationDrops.clear();`。deps 加 `translationDrops: () => Object.fromEntries(this.translationDrops)`。

`runtime-switch.ts`：deps 增 `translationDrops?: () => Record<string, unknown>`；handleRuntimeGet Pick + 响应 `translationDrops`。

`conformance.ts`：`ConformanceDeps` 增 `translationDrops?: () => Record<string, { unmatched: Record<string, number>; suppressed: Record<string, number> }>`；文件级 helper：

```typescript
function diffUnmatched(
  before: Record<string, { unmatched?: Record<string, number> }> | undefined,
  after: Record<string, { unmatched?: Record<string, number> }> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [src, d] of Object.entries(after ?? {})) {
    for (const [t, n] of Object.entries(d.unmatched ?? {})) {
      const delta = n - (before?.[src]?.unmatched?.[t] ?? 0);
      if (delta > 0) out[t] = (out[t] ?? 0) + delta;
    }
  }
  return out;
}
```

chat-roundtrip 分支（:92-99）改为：

```typescript
      if (sc.id === 'chat-roundtrip') {
        const sess = await deps.createSession({});
        const dropsBefore = deps.translationDrops?.();
        const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
        await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
        const events = await p;
        const drops = diffUnmatched(deps.translationDrops?.(), dropsBefore as any);
        const r = evaluateScenario(sc.id, events, undefined, undefined, undefined, { unmatched: drops });
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      }
```

`conformance-scenarios.ts`：`evaluateScenario` 追加第 6 参 `drops?: { unmatched: Record<string, number> }`，chat-roundtrip 分支尾部加：

```typescript
    if (drops && Object.keys(drops.unmatched ?? {}).length > 0) {
      failures.push(`unmatched native drops during scenario: ${JSON.stringify(drops.unmatched)} — vocabulary drift (update eventMappings)`);
    }
```

index.ts `conformanceDeps()` 加 `translationDrops: () => Object.fromEntries(this.translationDrops)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/routes/ tests/unit/runtime/conformance-scenarios.test.ts --silent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/routes/runtime-switch.ts gateway/src/routes/conformance.ts gateway/src/runtime/conformance-scenarios.ts gateway/tests/unit/routes/runtime-get.test.ts gateway/tests/unit/runtime/conformance-scenarios.test.ts
git commit -m "feat(runtime): B3 拦截可观测——translationDrops per-type 计数（unmatched/suppressed）、turn 终态 unmatched 每次 loud warn、/api/runtime 暴露、conformance unmatched===0 断言"
```

---

### Task 7: A-gateway——TOOL_CANONICAL_TABLE、canonicalToolOf、overlay canonical、enrich 双出口、collector 聚合键

**Files:**
- Modify: `gateway/src/runtime/tool-classes.ts`（TOOL_CANONICAL_TABLE/canonicalToolOf/overlay 扩展/enrichToolIdentity/enrichHistoryParts）
- Modify: `gateway/src/runtime/contract.ts`（`NativeToolDeclaration.canonical?`）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（PI_NATIVE_TOOLS 补 canonical）
- Modify: `gateway/src/index.ts`（:102 import 与 :1126 调用换 `enrichToolIdentity`；messages 路由 :5812 后挂 `enrichHistoryParts`）
- Modify: `gateway/src/trajectory/collector.ts`（:202/:213 聚合键）
- Test: `gateway/tests/unit/runtime/tool-classes.test.ts`

**Interfaces:**
- Produces: `canonicalToolOf(toolName): string | undefined`（解析链 overlay → 静态表 → 已是 opencode 名 → undefined）；`enrichToolIdentity(evt)`/`enrichHistoryParts(messages)`（session-ui/TUI 依赖 `part.canonicalTool` additive 字段）

- [ ] **Step 1: 写失败测试**（`tool-classes.test.ts` 追加）

```typescript
import { canonicalToolOf, enrichToolIdentity, enrichHistoryParts, setToolClassOverlay, clearToolClassOverlay } from '../../../src/runtime/tool-classes';

describe('A canonical 翻译层', () => {
  afterEach(() => clearToolClassOverlay());

  test('canonicalToolOf 解析链：overlay > 静态别名表 > opencode 名小写 > undefined', () => {
    expect(canonicalToolOf('command_execution')).toBe('bash');
    expect(canonicalToolOf('ls')).toBe('list');
    expect(canonicalToolOf('find')).toBe('glob');
    expect(canonicalToolOf('file_change')).toBe('edit');
    expect(canonicalToolOf('collab_tool_call')).toBe('task');
    expect(canonicalToolOf('web_search')).toBe('websearch');
    expect(canonicalToolOf('todo_list')).toBe('todowrite');
    expect(canonicalToolOf('powershell')).toBe('bash');
    expect(canonicalToolOf('Bash')).toBe('bash');   // 大小写归一
    expect(canonicalToolOf('Read')).toBe('read');
    expect(canonicalToolOf('bash')).toBe('bash');   // 已是 opencode 名 → 恒等
    expect(canonicalToolOf('mafw_python')).toBeUndefined(); // 未知名不硬猜
    setToolClassOverlay([{ name: 'my_search', toolClass: 'search', canonical: 'grep' }]);
    expect(canonicalToolOf('my_search')).toBe('grep'); // overlay 优先
  });

  test('enrichToolIdentity：part.updated tool part 补 toolClass + canonicalTool（additive，已有不覆写）', () => {
    const evt: any = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'command_execution', state: { input: { command: 'ls' } } } } } };
    enrichToolIdentity(evt);
    expect(evt.payload.properties.part.toolClass).toBe('shell');
    expect(evt.payload.properties.part.canonicalTool).toBe('bash');
    const again: any = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'x', toolClass: 'other', canonicalTool: 'keep' } } } };
    enrichToolIdentity(again);
    expect(again.payload.properties.part.toolClass).toBe('other'); // 不覆写
  });

  test('enrichHistoryParts：历史消息 tool parts 补两字段（幂等、非 tool 跳过）', () => {
    const msgs: any[] = [
      { info: { id: 'm1' }, parts: [{ type: 'tool', tool: 'ls', state: { input: { path: '/x' } } }, { type: 'text', text: 'hi' }] },
    ];
    enrichHistoryParts(msgs);
    expect(msgs[0].parts[0].toolClass).toBe('search');
    expect(msgs[0].parts[0].canonicalTool).toBe('list');
    enrichHistoryParts(msgs); // 幂等
    expect(msgs[0].parts[0].canonicalTool).toBe('list');
  });

  test('setToolClassOverlay 接受 canonical 声明（非法 canonical 忽略并报 invalid）', () => {
    const { applied, invalid } = setToolClassOverlay([
      { name: 'ls', toolClass: 'search', canonical: 'list' },
      { name: 'bad', toolClass: 'search', canonical: 42 },
    ]);
    expect(applied).toBe(1);
    expect(invalid).toHaveLength(1);
    expect(canonicalToolOf('ls')).toBe('list');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/tool-classes.test.ts --silent`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现**

`tool-classes.ts`：

import 区后加静态别名表 + overlay：

```typescript
/** 跨 runtime 工具别名 → opencode canonical 名（形状兼容才准入——调研 §2.2 矩阵；
 * opencode 自有名（bash/read/…）不进表，经 TOOL_CLASS_TABLE 小写命中返回自身）。 */
const TOOL_CANONICAL_TABLE: Record<string, string> = {
  // shell 域（input.command 键收敛）
  command_execution: 'bash', powershell: 'bash',
  // search/列举域（pattern+path / path 键收敛）
  ls: 'list', find: 'glob',
  // file-edit 域
  file_change: 'edit',
  // subagent 域
  collab_tool_call: 'task',
  // web 域
  web_search: 'websearch',
  // plan 域
  todo_list: 'todowrite',
};

/** runtime 声明的 canonical 覆盖（优先于静态表；小写归一）。 */
const toolCanonicalOverlay = new Map<string, string>();
```

`toolClassOf` 之后加：

```typescript
/** 工具名 → opencode canonical 名（undefined = 未知名不硬猜）。解析链：overlay 声明 → 静态别名表 → 已是 opencode 名（并集表命中）→ undefined。 */
export function canonicalToolOf(toolName: string | undefined | null): string | undefined {
  if (!toolName) return undefined;
  const lower = String(toolName).toLowerCase();
  return toolCanonicalOverlay.get(lower) ?? TOOL_CANONICAL_TABLE[lower]
    ?? (TOOL_CLASS_TABLE[lower] ? lower : undefined);
}
```

`enrichToolClass` 重命名并扩展为 `enrichToolIdentity`（保留原函数名为废弃别名不必——全仓只有 index.ts 一个调用点）：

```typescript
/**
 * wire enrich（additive）：tool part 快照补 `part.toolClass` + `part.canonicalTool`。
 * 单点 enrich（handleOpencodeEvent），eventTaps / trajectory / broadcast 全下游可见。
 */
export function enrichToolIdentity(evt: { type?: string; payload?: { type?: string; properties?: any } }): void {
  const type = evt?.payload?.type ?? evt?.type;
  if (type !== 'part.updated') return;
  const part = evt?.payload?.properties?.part;
  if (!part || part.type !== 'tool') return;
  if (part.toolClass === undefined) part.toolClass = toolClassOf(part.tool);
  if (part.canonicalTool === undefined) part.canonicalTool = canonicalToolOf(part.tool);
}

/** 历史 enrich（messages 路由出口，全 runtime）：tool parts 补两字段，幂等。 */
export function enrichHistoryParts(messages: any[]): void {
  if (!Array.isArray(messages)) return;
  for (const m of messages) {
    const parts = m?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part?.type !== 'tool') continue;
      if (part.toolClass === undefined) part.toolClass = toolClassOf(part.tool);
      if (part.canonicalTool === undefined) part.canonicalTool = canonicalToolOf(part.tool);
    }
  }
}
```

`setToolClassOverlay` 扩展（条目 + canonical）：

```typescript
export function setToolClassOverlay(entries: Array<{ name: unknown; toolClass: unknown; canonical?: unknown }>): { applied: number; invalid: string[] } {
  toolClassOverlay.clear();
  toolCanonicalOverlay.clear();
  const invalid: string[] = [];
  let applied = 0;
  for (const e of entries ?? []) {
    const name = typeof e?.name === 'string' ? e.name.trim().toLowerCase() : '';
    const cls = e?.toolClass;
    if (!name || typeof cls !== 'string' || !TOOL_CLASS_VALUES.has(cls)) {
      invalid.push(JSON.stringify(e));
      continue;
    }
    toolClassOverlay.set(name, cls as TOOL_CLASS);
    if (e.canonical !== undefined) {
      if (typeof e.canonical === 'string' && e.canonical.trim()) {
        toolCanonicalOverlay.set(name, e.canonical.trim().toLowerCase());
      } else {
        invalid.push(JSON.stringify(e));
        continue;
      }
    }
    applied++;
  }
  return { applied, invalid };
}
```

`clearToolClassOverlay` 加 `toolCanonicalOverlay.clear();`。

`contract.ts` `NativeToolDeclaration`：

```typescript
export interface NativeToolDeclaration {
  name: string;
  toolClass: TOOL_CLASS;
  /** opencode canonical 名（如 ls→list / find→glob）；缺省 = 名字本身即 canonical 或未声明。 */
  canonical?: string;
}
```

`pi-runtime.ts` `PI_NATIVE_TOOLS` 两行补 canonical：

```typescript
  { name: 'find', toolClass: 'search', canonical: 'glob' },
  { name: 'ls', toolClass: 'search', canonical: 'list' },
```

`index.ts`：:102 import 换 `enrichToolIdentity`；:1126 调用换 `enrichToolIdentity(evt)`；messages 路由（:5812 `const rawData = result.data || [];` 之后）加：

```typescript
            try { enrichHistoryParts(rawData); } catch { /* fail-open：历史 enrich 不阻断加载 */ }
```

（import 区加 `enrichHistoryParts`。）

`trajectory/collector.ts` :202 与 :213 两处 `toolName: part.tool,` → `toolName: part.canonicalTool ?? part.tool,`。

- [ ] **Step 4: 跑测试确认通过 + 邻近回归**

Run: `npx jest tests/unit/runtime/tool-classes.test.ts tests/unit/runtime/conformance-scenarios.test.ts tests/unit/trajectory --silent`（trajectory 若无独立目录则跑 `npx jest tests/unit --silent -t tool`）
Expected: PASS（conformance tool-visibility 场景经 enrichToolIdentity 仍过）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/tool-classes.ts gateway/src/runtime/contract.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/src/index.ts gateway/src/trajectory/collector.ts gateway/tests/unit/runtime/tool-classes.test.ts
git commit -m "feat(runtime): A canonical 翻译层——TOOL_CANONICAL_TABLE+canonicalToolOf 解析链、overlay canonical 声明、enrichToolIdentity 双出口（live+历史路由）、collector 聚合键改 canonicalTool ?? tool"
```

---

### Task 8: A-session-ui——四级查找链、displayTool、read 多 key、CLASS_FAMILY、上下文组

**Files:**
- Modify: `packages/session-ui/src/components/parts-rules.ts`（PartLike.canonicalTool + displayToolOf + 判定函数 canonical 感知）
- Modify: `packages/session-ui/src/components/message-part.tsx`（:1641 查找链 / read 卡 :1897 多 key / getToolInfo :489-493 / contextToolTrigger :881-931 / contextToolSummary :933-938 / isContextGroupTool :862 / partDefaultOpen :744-747）
- Test: `packages/session-ui/src/components/tool-canonical.test.ts`（新建）

**Interfaces:**
- Consumes: Task 7 的 `part.canonicalTool`/`part.toolClass` additive 字段
- Produces: `displayToolOf(part: PartLike): string`、`resolveToolRender(part)`、`readPathInput(input)`、`CLASS_FAMILY`（session-ui 内部 + desktop 依赖包导出）

- [ ] **Step 1: 写失败测试**（`tool-canonical.test.ts` 新建，bun:test）

```typescript
import { describe, expect, test } from "bun:test"
import { displayToolOf, isTopLevelToolEntry } from "./parts-rules"
import { getToolInfo, resolveToolRender, CLASS_FAMILY, readPathInput, registerTool, GenericTool } from "./message-part"

describe("canonical 翻译层（session-ui 消费面）", () => {
  test("displayToolOf：canonicalTool ?? tool", () => {
    expect(displayToolOf({ type: "tool", tool: "command_execution", canonicalTool: "bash" })).toBe("bash")
    expect(displayToolOf({ type: "tool", tool: "bash" })).toBe("bash")
    expect(displayToolOf({ type: "tool", tool: "x", canonicalTool: "" })).toBe("x")
  })

  test("resolveToolRender 四级链：原生名 > canonical > class 家族 > GenericTool", () => {
    registerTool({ name: "bash", render: () => null as any })
    // 原生名直命中
    expect(resolveToolRender({ type: "tool", tool: "bash" } as any)).toBeDefined()
    // canonical 命中（command_execution → bash）
    expect(resolveToolRender({ type: "tool", tool: "command_execution", canonicalTool: "bash" } as any)).toBeDefined()
    // class 家族兜底（未注册名 + toolClass=shell → bash 卡）
    expect(resolveToolRender({ type: "tool", tool: "my_shell", toolClass: "shell" } as any)).toBeDefined()
    expect(CLASS_FAMILY["shell"]).toBe("bash")
    // 全 miss → GenericTool
    expect(resolveToolRender({ type: "tool", tool: "mystery" } as any)).toBe(GenericTool)
  })

  test("readPathInput 多 key：filePath ?? path ?? file_path（pi/Claude 键）", () => {
    expect(readPathInput({ filePath: "/a" })).toBe("/a")
    expect(readPathInput({ path: "/b" })).toBe("/b")
    expect(readPathInput({ file_path: "/c" })).toBe("/c")
    expect(readPathInput({})).toBeUndefined()
  })

  test("isTopLevelToolEntry：上下文组成员资格看 canonical（ls → list 进上下文组）", () => {
    expect(isTopLevelToolEntry({ type: "tool", tool: "ls", canonicalTool: "list" })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "bash" })).toBe(true)
  })
})
```

注：`getToolInfo` 依赖 i18n context，不做直接单测——多 key 经 `readPathInput` 覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/components/tool-canonical.test.ts`（workdir `packages/session-ui`）
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现**

`parts-rules.ts`：

```typescript
export interface PartLike {
  type: string
  tool?: string
  canonicalTool?: string
  callID?: string
  text?: string
  state?: { status?: string }
}

export const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
export const HIDDEN_TOOLS = new Set(["todowrite"])

/** canonical 翻译层（gateway enrich 的 additive 字段）：显示/分组/聚合统一用解析名。 */
export function displayToolOf(part: PartLike): string {
  return typeof part.canonicalTool === "string" && part.canonicalTool ? part.canonicalTool : part.tool ?? ""
}
```

`renderable` 的 `HIDDEN_TOOLS.has(part.tool)` → `HIDDEN_TOOLS.has(displayToolOf(part))`；`isTopLevelToolEntry` 的 `HIDDEN_TOOLS`/`CONTEXT_GROUP_TOOLS` 两处同样换 `displayToolOf(part)`。

`message-part.tsx`：

1. `parts-rules` import 补 `displayToolOf`；文件内（`toolDefaultOpen` :739 附近）加：

```typescript
/** toolClass → 代表内建卡名（D12：未注册名按语义家族兜底渲染）。 */
export const CLASS_FAMILY: Record<string, string> = {
  shell: "bash",
  readonly: "read",
  search: "grep",
  "file-edit": "edit",
  subagent: "task",
  web: "webfetch",
  plan: "todowrite",
}

function toolClassOfPart(part: any): string | undefined {
  const v = part?.toolClass
  return typeof v === "string" && v ? v : undefined
}

/** 四级渲染解析（纯函数可测）：原生名 > canonical > class 家族 > GenericTool。 */
export function resolveToolRender(part: any): ToolComponent {
  const canonical = displayToolOf(part)
  const family = toolClassOfPart(part)
  return (
    ToolRegistry.render(part.tool)
    ?? (canonical && canonical !== part.tool ? ToolRegistry.render(canonical) : undefined)
    ?? (family ? ToolRegistry.render(CLASS_FAMILY[family]) : undefined)
    ?? GenericTool
  )
}

/** read 域三套键（opencode filePath / pi path / Claude file_path）——commandTextOf 多 key 先例。 */
export function readPathInput(input: any): string | undefined {
  const v = input?.filePath ?? input?.path ?? input?.file_path
  return typeof v === "string" && v ? v : undefined
}
```

2. `:1641` 渲染解析改 `const render = createMemo(() => resolveToolRender(part()))`。

3. read 卡（:1897）副标题：`subtitle: props.input.filePath ? getFilename(props.input.filePath) : ""` → `subtitle: (() => { const p = readPathInput(props.input); return p ? getFilename(p) : "" })()`。

4. `getToolInfo`（:489-493）read/edit/write 三 case 副标题 `input.filePath ? getFilename(input.filePath) : undefined` → `readPathInput(input) ? getFilename(readPathInput(input)!) : undefined`；bash case 不动（`input.command` 键已收敛）。

5. `contextToolTrigger`（:884）`const filePath = typeof input.filePath === "string" ? input.filePath : undefined` → `const filePath = readPathInput(input)`；`switch (part.tool)` → `switch (displayToolOf(part))`（:890）；default 分支 `getToolInfo(part.tool, ...)` → `getToolInfo(displayToolOf(part), ...)`。

6. `isContextGroupTool`（:862-864）：`CONTEXT_GROUP_TOOLS.has(part.tool)` → `CONTEXT_GROUP_TOOLS.has(displayToolOf(part))`。

7. `contextToolSummary`（:933-938）：三处 `part.tool === "read"/"glob"/"grep"/"list"` → `const d = displayToolOf(part)` 比较（`d === "read"` / `d === "glob" || d === "grep"` / `d === "list"`）。

8. `partDefaultOpen`（:744-747）：`toolDefaultOpen(part.tool, shell, edit)` → `toolDefaultOpen(displayToolOf(part), shell, edit)`。

- [ ] **Step 4: 跑测试确认通过 + session-ui 全量**

Run: `bun test src`（workdir `packages/session-ui`）
Expected: PASS（既有 message-file / parts 相关测试不回归）

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/parts-rules.ts packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/tool-canonical.test.ts
git commit -m "feat(session-ui): canonical 渲染链——四级查找（原生>canonical>CLASS_FAMILY>Generic）、displayToolOf、read 域多 key、上下文组成员资格 canonical 感知"
```

---

### Task 9: A-TUI 聚合键 + AGENTS.md 文档

**Files:**
- Modify: `packages/tui/src/store/chat-store.ts`（:339/:357 toolName 取 canonicalTool ?? tool）
- Modify: `AGENTS.md`（§5.19 事件映射注册段 + NativeToolDeclaration.canonical + enrich 双出口）
- Test: `packages/tui/tests/tool-canonical.test.ts`（新建）

**Interfaces:**
- Consumes: Task 7 `part.canonicalTool`（历史经 enrichHistoryParts、live 经 enrichToolIdentity）

- [ ] **Step 1: 写失败测试**（`tool-canonical.test.ts` 新建；`historyPart`/`livePart` 需 export——见 Step 3）

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyPart, livePart } from '../src/store/chat-store.ts'

test('historyPart/livePart 的 toolName 取 canonicalTool ?? tool（聚合不按别名碎片化）', () => {
  const h = historyPart({ id: 'p1', type: 'tool', tool: 'command_execution', canonicalTool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'x' } })
  assert.equal(h?.toolName, 'bash')
  const l = livePart({ id: 'p2', type: 'tool', tool: 'ls', canonicalTool: 'list', state: { status: 'running', input: { path: '/x' } } })
  assert.equal(l?.toolName, 'list')
  const plain = livePart({ id: 'p3', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'x' } } })
  assert.equal(plain?.toolName, 'bash') // 无 canonical 原样
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/tool-canonical.test.ts`（workdir `packages/tui`）
Expected: FAIL（historyPart/livePart 未导出）

- [ ] **Step 3: 实现**

`chat-store.ts`：`function historyPart(...)`/`function livePart(...)` 改 `export function`；:339 `toolName: p.tool,` → `toolName: p.canonicalTool ?? p.tool,`；:357 同改。（session-recap.ts:37 无需改动——聚合的 toolName 已是 canonical。）

`AGENTS.md` §5.19「事件映射注册」段更新（逐条）：
- 匹配优先级行改为：`eventMappings（数组序，含 drop 行与 canonicalIdentity() 恒等行）→ transformEvent（B2 守卫：try/catch+输出校验）→ 拦截 + 计数`；补一句「canonical 直发分支已删除（B1 default-deny）：同名收编词经词汇单源派生的 identity 行注册；无声明 runtime = eventStream 加载期降级」
- 补一行：`/api/runtime` 暴露 `translationErrors`（守卫失败限频 ERROR+计数）与 `translationDrops`（per-type unmatched/suppressed；turn 终态 unmatched 每次 loud warn；conformance 断言 unmatched===0）
- `NativeToolDeclaration` 描述补 `canonical?: string`（overlay 声明，`canonicalToolOf` 解析链 overlay→TOOL_CANONICAL_TABLE→opencode 名）
- 补一行：enrich 双出口 `enrichToolIdentity`（live 单点）+ `enrichHistoryParts`（messages 路由，全 runtime）；session-ui 四级查找链 `原生名 > canonicalTool > CLASS_FAMILY[toolClass] > GenericTool` + read 域多 key（`filePath ?? path ?? file_path`）；TUI/trajectory 聚合键 `canonicalTool ?? tool`

- [ ] **Step 4: 跑测试确认通过 + TUI 全量**

Run: `node --test tests/tool-canonical.test.ts && node --test tests/*.test.ts`（workdir `packages/tui`；全套约 220 用例）
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/store/chat-store.ts packages/tui/tests/tool-canonical.test.ts AGENTS.md
git commit -m "feat(tui): 工具聚合键改 canonicalTool ?? tool（recap 不再按别名碎片化）+ AGENTS.md B1/B2/B3/A 语义更新"
```

---

### Task 10: D 加载收敛——createRuntime 分支合一 + switch 特判删除

**Files:**
- Modify: `gateway/src/index.ts`（createRuntime 重构为 `activatePluginRuntime` 单路径 + opencode 兜底 + direct 安全网）
- Modify: `gateway/src/routes/runtime-switch.ts`（删 `plugin !== 'opencode'` 特判 :70）
- Test: `gateway/tests/unit/routes/runtime-switch.test.ts`（若不存在则新建；同时跑 `tests/unit/runtime/loader*.test.ts` 回归）

**Interfaces:**
- Consumes: Task 4 `hasEventDeclarations`、Task 2 hooks 形态
- Produces: `createRuntime` 无 opencode 硬编码分支（direct import 仅 loader 缺失安全网）；`activatePluginRuntime(name, sdkConfig, fatal): Promise<AgentRuntime | null>`（私有）

- [ ] **Step 1: 写失败测试**（`runtime-switch.test.ts` 新建或追加——`POST /api/runtime/switch {plugin:'opencode'}` 走 loader 校验路径）

```typescript
import { handleRuntimeSwitch } from '../../../src/routes/runtime-switch';
import * as http from 'http';

function fakeRes() {
  const res: any = { statusCode: 0, body: '' as any, writeHead(c: number) { this.statusCode = c; return this; }, end(b?: string) { this.body = b ? JSON.parse(b) : ''; return this; } };
  return res;
}
function fakeReq(body: any) {
  return { on(ev: string, cb: (d?: string) => void) { if (ev === 'data') cb(JSON.stringify(body)); if (ev === 'end') cb(); } } as any;
}

test('switch 到 opencode 同样走 loader 校验（特判已删）：未注册名 400', async () => {
  const deps: any = {
    loader: { get: (n: string) => (n === 'opencode' ? { createRuntime: async () => ({ name: 'opencode', capabilities: {} }) } : undefined), getState: () => [{ name: 'opencode' }] },
    persist: () => ({ changed: [] }),
    getCurrent: () => null,
    runtimeName: () => 'pi',
    runtimeCaps: () => ({}),
    envOverride: () => false,
    createRuntime: async () => ({ name: 'opencode', capabilities: {} }),
    onSwitched: async () => {},
  };
  const ok = fakeRes();
  await handleRuntimeSwitch(fakeReq({ plugin: 'opencode' }), ok, deps);
  expect(ok.statusCode).toBe(200); // opencode 经 loader.get 命中 → 正常切换
  const missing = fakeRes();
  await handleRuntimeSwitch(fakeReq({ plugin: 'ghost' }), missing, deps);
  expect(missing.statusCode).toBe(400);
  expect(missing.body.error).toContain('ghost');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/routes/runtime-switch.test.ts --silent`
Expected: FAIL（现实现 `'opencode'` 特判跳过 loader.get——200 语义一致但断言的 400 路径/文件不存在）

- [ ] **Step 3: 实现**

`runtime-switch.ts` :69-80 收敛为：

```typescript
  const plugin = typeof body?.plugin === 'string' ? body.plugin.trim() : '';
  if (plugin) {
    const found = deps.loader?.get(plugin);
    if (!found) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `Runtime plugin '${plugin}' not found`,
        available: deps.loader?.getState().map(s => s.name).filter(Boolean) ?? [],
      }));
      return;
    }
  }
```

`index.ts` `createRuntime` 整体替换 + 新私有方法（保留全部既有接线语义：validation/activateRuntimeTools/降级兜底/wrap 序列/wrapRuntimeIdentity）：

```typescript
  /**
   * Runtime 选择：单查找路径——config.runtime.plugin 缺省 'opencode'（loader 注册表成员，
   * 文件>包>内置统一优先级）；失败/缺失回退 opencode；loader 未注册 opencode 时 direct import
   * 安全网（不应发生）。
   */
  private async createRuntime(sdkConfig: { baseUrl: string; directory?: string; headers: Record<string, string> }): Promise<AgentRuntime> {
    const wanted = config.runtime?.plugin || 'opencode';
    const rt = await this.activatePluginRuntime(wanted, sdkConfig, true);
    if (rt) return rt;
    if (wanted !== 'opencode') {
      log.warn(`[Runtime] plugin '${wanted}' unavailable — falling back to opencode`);
      const fallback = await this.activatePluginRuntime('opencode', sdkConfig, false);
      if (fallback) return fallback;
    }
    // 最终安全网：loader 未注册 opencode 时直连（不应发生）
    const { createOpencodeRuntime } = await import('./runtime/opencode-runtime.js');
    const fallbackRt = await createOpencodeRuntime({ ...sdkConfig });
    this.applyRuntimeValidation(fallbackRt, 'builtin:opencode(direct)', false);
    await activateRuntimeTools(fallbackRt, 'builtin:opencode(direct)', { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
    wrapGlobalEventStream(fallbackRt, {
      eventSource: OPENCODE_EVENT_SOURCE,
      eventMappings: OPENCODE_EVENT_MAPPINGS,
    }, (t) => CANONICAL_TYPE_SET.has(t), {
      onUnmatched: (t) => this.recordTranslationDrop('opencode', t, 'unmatched'),
      onSuppressed: (t) => this.recordTranslationDrop('opencode', t, 'suppressed'),
      onTranslationError: (_raw, reason) => this.recordTranslationError('opencode', 'transformEvent', reason),
    });
    wrapToolPartAssembly(fallbackRt);
    return this.wrapRuntimeIdentity(fallbackRt);
  }

  /** 单激活路径（D 收敛）：plugin/builtin/package 同一序列。fatal=true 时校验失败抛错触发回退。 */
  private async activatePluginRuntime(
    name: string,
    _sdkConfig: { baseUrl: string; directory?: string; headers: Record<string, string> },
    fatal: boolean,
  ): Promise<AgentRuntime | null> {
    const plugin = this.runtimeLoader?.get(name);
    if (!plugin) return null;
    try {
      const creds = name === 'opencode' ? undefined : await this.runtimeCredentialsForPlugin();
      const rt = await plugin.createRuntime(createRuntimePluginContext(creds, {
        projectDir: this.resolvedProjectDir(),
        gatewayPort: config.server.apiPort,
      }));
      // 声明 vs 实现一致性校验：必选面缺失 → 回退；能力位虚报 → 强制降级
      this.applyRuntimeValidation(rt, name, fatal);
      // 工具注册通道接线（Tier-0）
      await activateRuntimeTools(rt, name, { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
      // B1 D2 兜底：包贡献 runtime 不经 loader.loadFile 降级路径
      if ((rt.capabilities as any)?.eventStream && !hasEventDeclarations(plugin)) {
        (rt.capabilities as any).eventStream = false;
        log.error(`[Runtime] '${rt.name}' declares no event translations — eventStream downgraded (default-deny would drop the entire native stream)`);
      }
      wrapGlobalEventStream(rt, plugin, (t) => CANONICAL_TYPE_SET.has(t), {
        onUnmatched: (t) => this.recordTranslationDrop(rt.name, t, 'unmatched'),
        onSuppressed: (t) => this.recordTranslationDrop(rt.name, t, 'suppressed'),
        onTranslationError: (_raw, reason) => this.recordTranslationError(rt.name, 'transformEvent', reason),
        onNoMappings: () => {
          log.warn(`[Runtime] '${rt.name}' declares no event mappings/transformEvent — eventStream should have been downgraded`);
        },
      });
      wrapToolPartAssembly(rt);
      log.info(`[Runtime] using runtime '${rt.name}' (capabilities: ${JSON.stringify(rt.capabilities)})`);
      return this.wrapRuntimeIdentity(rt);
    } catch (err: any) {
      log.warn(`[Runtime] '${name}' createRuntime failed: ${err.message}${fatal ? ' — falling back' : ''}`);
      return null;
    }
  }
```

（Task 4 在旧插件分支加的兜底降级随本任务迁入 `activatePluginRuntime`；三处重复 wrap 调用点收敛为两处——helper + direct 安全网。旧 plugin/builtin/direct 三段分支删除。）

- [ ] **Step 4: 跑测试确认通过 + gateway 全量**

Run: `npx jest tests/unit/routes/runtime-switch.test.ts tests/unit/runtime/ --silent`（workdir `gateway`）
Expected: PASS（loader*/opencode-events/event-replay 等既有用例零回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/routes/runtime-switch.ts gateway/tests/unit/routes/runtime-switch.test.ts
git commit -m "refactor(runtime): D 加载收敛——createRuntime 单查找路径（activatePluginRuntime helper），opencode 纯注册表成员，switch 特判删除"
```

---

### Task 11: 全量回归 + build

**Files:** 无新改动（验证任务）

- [ ] **Step 1: gateway 全量**

Run: `npx jest --runInBand --silent`（workdir `gateway`）
Expected: 全绿（308+ 套件基线 + 本批新增）

- [ ] **Step 2: session-ui + desktop + TUI**

Run: `bun test src`（workdir `packages/session-ui`）；`bun test`（workdir `packages/desktop`）；`node --test tests/*.test.ts`（workdir `packages/tui`）
Expected: 全绿

- [ ] **Step 3: 构建**

Run: `npm run build`（workdir 仓库根）
Expected: exit 0（plugin + gateway + sdk + tui）

- [ ] **Step 4: 汇报**

汇报格式：新增测试数 / 全量通过数（gateway + session-ui + desktop + tui）/ 各任务 commit 哈希清单。

---

## Self-Review 记录

- **Spec 覆盖**：B1（Task 1-4：identity 派生/链改造/transformEvent 退役/无声明降级+audit+README）、B2（Task 5）、B3（Task 6）、A（Task 7 gateway + Task 8 session-ui + Task 9 TUI/文档）、D（Task 10）、验收对齐 spec §6（B1 canonical 形状无行不再透传 ✓ / B2 违规计数 ✓ / B3 conformance 断言 ✓ / A 渲染链 ✓ / D switch 走 loader ✓）
- **类型一致性**：`TranslationHooks` 三回调签名在 Task 2/5/6 三任务间一致；`hasEventDeclarations` Task 4 产出 Task 10 消费；`canonicalToolOf`/`enrichToolIdentity`/`enrichHistoryParts` Task 7 产出 Task 8/9 消费；session-ui `displayToolOf` 在 parts-rules 定义、message-part 导入
- **顺序依赖**：Task 1（identity 行）必须先于 Task 2（删直发分支）——否则 opencode 同名词断流；Task 3 依赖 Task 2（suppressed 语义）；Task 10 依赖 Task 4/5/6 的 hooks 与降级产出
