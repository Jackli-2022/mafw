# 事件映射注册接口实施计划（Event Mapping Registration）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** runtime 插件用纯数据表声明「原生事件 → canonical 事件」映射，消灭手写适配层；opencode 的 normalize 硬编码 if 链表化；pi 迁入并顺手修 turn_end step facet 不对齐 bug。

**Architecture:** 两张表一条链——插件侧 `PluginEventMap`（原生→canonical，纯数据 + transformEvent 逃逸口），gateway 侧 `CanonicalFacetTable`（canonical→EventFacets，纯数据）。spec：`docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md`。

**Tech Stack:** TypeScript（gateway，CommonJS，jest）、纯函数优先（deps 注入可单测）。

## Global Constraints

- **TDD**：每个任务先写失败测试再实现（用户硬偏好）
- **jest 不 typecheck `gateway/src/index.ts`**——改 index.ts 后必须 `npm run build`（root）验证
- **中文内容只经 write/edit 工具写入**（PowerShell 管道 UTF-8 损坏）
- `git add` 路径必须 repo 根相对
- 测试命令：`cd gateway; npx jest <testPath> --runInBand`（全量：`cd gateway; npx jest --runInBand`）
- 当前基线：235 suites / 1553 tests（v4.19.0）
- canonical 词汇表单一事实源：`packages/gateway-sdk/src/events.ts` + `gateway/src/runtime/event-flow-matrix.ts`（交叉校验测试强制双向一致）
- 路径语法 = 裁剪 JSONPath 子集（点号段 + 数组下标，无 eval、无脚本表达式）

---

### Task 1: path-expr 纯函数基元

**Files:**
- Create: `gateway/src/runtime/path-expr.ts`
- Test: `gateway/tests/unit/runtime/path-expr.test.ts`

**Interfaces:**
- Produces（后续所有任务依赖）:
  - `isValidPath(p: string): boolean`
  - `getPath(obj: unknown, path: string): unknown`（路径不存在/非法 → undefined）
  - `evalConditions(conds: Condition[] | undefined, raw: unknown): boolean`（空 = true；`exists` = truthy 检查）
  - `renderTemplate(tpl: string, raw: unknown): string | undefined`（任一插值路径不存在 → undefined = 字段不创建）
  - `setPath(obj: Record<string, any>, dottedKey: string, value: unknown): void`（fields 构造目标，仅点号段无下标）
  - `interface Condition { path: string; equals?: unknown; exists?: true }`

- [ ] **Step 1: 写失败测试**

```ts
import { isValidPath, getPath, evalConditions, renderTemplate, setPath } from '../../../src/runtime/path-expr';

describe('isValidPath', () => {
  test.each(['$.type', '$.part.type', '$.a[0].b', '$.items[12]', '$.session-id'])('valid: %s', (p) => {
    expect(isValidPath(p)).toBe(true);
  });
  test.each(['type', '$.a b', '$.a[', '$..a', '$.a;alert(1)', '$.a[(...)]', ''])('reject: %s', (p) => {
    expect(isValidPath(p)).toBe(false);
  });
});

describe('getPath', () => {
  const obj = { part: { type: 'step-finish', list: [{ id: 'x' }] }, n: 0, s: '' };
  test('nested + index', () => {
    expect(getPath(obj, '$.part.type')).toBe('step-finish');
    expect(getPath(obj, '$.part.list[0].id')).toBe('x');
  });
  test('missing → undefined（不抛）', () => {
    expect(getPath(obj, '$.part.missing.deep')).toBeUndefined();
    expect(getPath(null, '$.a')).toBeUndefined();
    expect(getPath(obj, 'not-a-path')).toBeUndefined();
  });
  test('falsy 值原样返回', () => {
    expect(getPath(obj, '$.n')).toBe(0);
    expect(getPath(obj, '$.s')).toBe('');
  });
});

describe('evalConditions', () => {
  const raw = { part: { type: 'step-finish' }, time: { completed: 123 }, s: '' };
  test('undefined/空数组 → true', () => {
    expect(evalConditions(undefined, raw)).toBe(true);
    expect(evalConditions([], raw)).toBe(true);
  });
  test('equals', () => {
    expect(evalConditions([{ path: '$.part.type', equals: 'step-finish' }], raw)).toBe(true);
    expect(evalConditions([{ path: '$.part.type', equals: 'text' }], raw)).toBe(false);
  });
  test('exists = truthy（空串/0 不算存在——对齐 normalize 现状 `||` 语义）', () => {
    expect(evalConditions([{ path: '$.time.completed', exists: true }], raw)).toBe(true);
    expect(evalConditions([{ path: '$.s', exists: true }], raw)).toBe(false);
    expect(evalConditions([{ path: '$.missing', exists: true }], raw)).toBe(false);
  });
  test('多条件 AND', () => {
    expect(evalConditions([
      { path: '$.part.type', equals: 'step-finish' },
      { path: '$.time.completed', exists: true },
    ], raw)).toBe(true);
  });
});

describe('renderTemplate', () => {
  test('插值', () => {
    expect(renderTemplate('pi_step_{$.sessionID}', { sessionID: 'abc' })).toBe('pi_step_abc');
  });
  test('路径不存在 → undefined（EventBridge 语义：字段不创建）', () => {
    expect(renderTemplate('pi_step_{$.missing}', {})).toBeUndefined();
  });
  test('非字符串值 String() 化', () => {
    expect(renderTemplate('n={$.n}', { n: 42 })).toBe('n=42');
  });
});

describe('setPath', () => {
  test('构造嵌套', () => {
    const o: Record<string, any> = {};
    setPath(o, 'part.type', 'text');
    setPath(o, 'part.text', 'hi');
    expect(o).toEqual({ part: { type: 'text', text: 'hi' } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/path-expr.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
/**
 * 裁剪 JSONPath 子集求值器 —— 事件映射表/facet 规则表共用。
 * 仅点号段 + 数组下标；无 eval、无脚本表达式（表达式价值 = 可被宿主静态校验，
 * eval 一开此价值归零——同进程可信插件下这不是安全问题是可分析性问题）。
 */

/** 纯数据条件。equals 与 exists 二选一；exists = truthy 检查（对齐现状 `||` 语义）。 */
export interface Condition {
  path: string;
  equals?: unknown;
  exists?: true;
}

const PATH_RE = /^\$(\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/;
const SEG_RE = /\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\]/g;

export function isValidPath(p: string): boolean {
  return typeof p === 'string' && PATH_RE.test(p);
}

export function getPath(obj: unknown, path: string): unknown {
  if (!isValidPath(path)) return undefined;
  const segs = path.slice(1).match(SEG_RE) ?? [];
  let cur: any = obj;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    cur = s[0] === '.' ? cur[s.slice(1)] : cur[Number(s.slice(1, -1))];
  }
  return cur;
}

export function evalConditions(conds: Condition[] | undefined, raw: unknown): boolean {
  if (!conds || conds.length === 0) return true;
  for (const c of conds) {
    const v = getPath(raw, c.path);
    if (c.exists === true) {
      if (!v) return false;
    } else if ('equals' in c) {
      if (v !== c.equals) return false;
    } else {
      return false; // 畸形条件（加载期校验应已拦截）
    }
  }
  return true;
}

const TPL_RE = /\{(\$[^}]*)\}/g;

/** EventBridge 式模板：'pi_step_{$.sessionID}'。任一插值路径不存在 → undefined。 */
export function renderTemplate(tpl: string, raw: unknown): string | undefined {
  let missing = false;
  const out = tpl.replace(TPL_RE, (_m, p: string) => {
    const v = getPath(raw, p);
    if (v === undefined || v === null) { missing = true; return ''; }
    return String(v);
  });
  return missing ? undefined : out;
}

/** fields 构造目标写入（仅点号段，无下标——构造场景不需要数组）。 */
export function setPath(obj: Record<string, any>, dottedKey: string, value: unknown): void {
  const segs = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/runtime/path-expr.test.ts --runInBand`
Expected: PASS（全绿）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/path-expr.ts gateway/tests/unit/runtime/path-expr.test.ts
git commit -m "feat(runtime): path-expr primitives for declarative event mapping (safe JSONPath subset)"
```

---

### Task 2: event-mapper（插件映射表执行器 + 校验 + 流包装）

**Files:**
- Create: `gateway/src/runtime/event-mapper.ts`
- Test: `gateway/tests/unit/runtime/event-mapper.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `getPath/evalConditions/renderTemplate/setPath/Condition`
- Produces（Task 5/6/7 依赖）:
  - `interface EventSourceShape { typePath: string; sessionIdPath?: string; directoryPath?: string }`
  - `type FieldValue = { path: string; default?: unknown } | { const: unknown } | { template: string }`
  - `interface EventMapping { from: string | string[]; to: string; when?: Condition[]; fields?: Record<string, FieldValue> }`
  - `type TransformEventFn = (raw: any) => any | any[] | null`
  - `interface EventMappingEntry { eventSource?: EventSourceShape; eventMappings?: EventMapping[]; transformEvent?: TransformEventFn }`
  - `applyEventMappings(raw: any, entry: EventMappingEntry, isCanonicalType: (t: string) => boolean, onUnknown?: (t: string) => void): any[]`
  - `validateEventMappings(entry: EventMappingEntry, canonicalTypes: ReadonlySet<string>): string[]`
  - `wrapGlobalEventStream(rt: any, entry: EventMappingEntry, isCanonicalType: (t: string) => boolean, onUnknown?: (t: string) => void): void`（原地包装 rt.global.event）

**匹配语义（plan 级钉扎）**：
1. `type = getPath(raw, source.typePath)`；取不到 → **原样 passthrough**（已是 canonical 信封或畸形事件，下游各自处理——pi push 的 permission.asked 走这条路）
2. 首个 `from` 命中且 `when` 全过的映射：`to:'drop'` → `[]`；否则构造 `{ payload: { type: to, properties } }`
3. 未命中但 `type` 是 canonical → passthrough `[raw]`
4. 未命中非 canonical → `transformEvent`（返回 null=丢弃 / 数组=扇出）
5. 仍无 → `[]` + `onUnknown(type)`（遥测钩子）
6. sessionID 自动注入约定：`message.part.updated` → `part.sessionID`；其余 → `properties.sessionID`（**与 pi 现状输出逐字节对齐**，message_end 的 `properties.sessionID` + `info` 不带 sessionID 是刻意的）
7. `{path, default}` 的 default 是 **nullish** 语义（`??`，对齐 pi 现状 `event?.delta ?? ''`）

- [ ] **Step 1: 写失败测试**

```ts
import {
  applyEventMappings, validateEventMappings, EventMappingEntry,
} from '../../../src/runtime/event-mapper';

const CANONICAL = new Set(['session.idle', 'session.updated', 'message.updated', 'message.part.updated', 'permission.asked']);
const isCanonical = (t: string) => CANONICAL.has(t);

const PI: EventMappingEntry = {
  eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
  eventMappings: [
    { from: ['agent_end', 'agent_settled'], to: 'session.idle' },
    { from: 'agent_start', to: 'session.updated' },
    { from: ['message_start', 'message_update'], to: 'message.part.updated',
      fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } } },
    { from: 'message_end', to: 'message.updated', fields: { 'info.role': { const: 'assistant' } } },
    { from: 'turn_end', to: 'message.part.updated',
      fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } } },
    { from: 'queue_update', to: 'drop' },
  ],
};

test('纯改名 + sessionID 注入（properties 级）', () => {
  expect(applyEventMappings({ type: 'agent_end', sessionID: 's1' }, PI, isCanonical))
    .toEqual([{ payload: { type: 'session.idle', properties: { sessionID: 's1' } }, sessionID: 's1', directory: undefined }]);
});

test('字段构造 + part 级 sessionID 注入 + path default（nullish）', () => {
  expect(applyEventMappings({ type: 'message_update', sessionID: 's1', delta: 'he' }, PI, isCanonical))
    .toEqual([{ payload: { type: 'message.part.updated', properties: { part: { type: 'text', text: 'he', sessionID: 's1' } } }, sessionID: 's1', directory: undefined }]);
  // delta 缺席 → default ''
  const out = applyEventMappings({ type: 'message_update', sessionID: 's1' }, PI, isCanonical);
  expect((out[0] as any).payload.properties.part.text).toBe('');
});

test('template ID 物化（turn_end → part.messageID）', () => {
  const out = applyEventMappings({ type: 'turn_end', sessionID: 's1' }, PI, isCanonical);
  expect((out[0] as any).payload.properties.part).toEqual({
    type: 'step-finish', messageID: 'pi_step_s1', sessionID: 's1',
  });
});

test('when 条件不满足 → 跳过该行', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [
      { from: 'x', to: 'session.idle', when: [{ path: '$.ok', equals: true }] },
      { from: 'x', to: 'session.updated' },
    ],
  };
  expect(applyEventMappings({ type: 'x', ok: false }, entry, isCanonical)[0].payload.type).toBe('session.updated');
});

test('drop + 未命中 canonical passthrough + 未知丢弃并遥测', () => {
  expect(applyEventMappings({ type: 'queue_update', sessionID: 's1' }, PI, isCanonical)).toEqual([]);
  // canonical 原生直发 → passthrough
  const raw = { type: 'session.idle', properties: { sessionID: 's1' } };
  expect(applyEventMappings(raw, PI, isCanonical)).toEqual([raw]);
  // 未知 → drop + onUnknown
  const unknown: string[] = [];
  expect(applyEventMappings({ type: 'mystery' }, PI, isCanonical, (t) => unknown.push(t))).toEqual([]);
  expect(unknown).toEqual(['mystery']);
});

test('transformEvent 逃逸口：未匹配时调用；null=丢弃，数组=扇出', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [],
    transformEvent: (raw) => raw.type === 'fan' ? [{ payload: { type: 'session.idle', properties: {} } }, null].filter(Boolean) : null,
  };
  expect(applyEventMappings({ type: 'other' }, entry, isCanonical)).toEqual([]);
  expect(applyEventMappings({ type: 'fan' }, entry, isCanonical)).toHaveLength(1);
});

test('无 top-level type（已 canonical 信封）→ 原样 passthrough', () => {
  const pushed = { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r1' } } };
  expect(applyEventMappings(pushed, PI, isCanonical)).toEqual([pushed]);
});

test('message_end 精确形状（properties.sessionID + info 无 sessionID）', () => {
  const out = applyEventMappings({ type: 'message_end', sessionID: 's1' }, PI, isCanonical);
  expect((out[0] as any).payload.properties).toEqual({ sessionID: 's1', info: { role: 'assistant' } });
});

describe('validateEventMappings', () => {
  test('未知 canonical to → issue', () => {
    const issues = validateEventMappings({ eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'a', to: 'not.a.type' }] }, CANONICAL);
    expect(issues.some((i) => i.includes('not.a.type'))).toBe(true);
  });
  test('drop 合法；非法路径 → issue；缺 eventSource.typePath → issue', () => {
    expect(validateEventMappings({ eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'a', to: 'drop' }] }, CANONICAL)).toEqual([]);
    expect(validateEventMappings({ eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'a', to: 'session.idle', fields: { 'x.y': { path: 'bad path' } } }] }, CANONICAL)).toHaveLength(1);
    expect(validateEventMappings({ eventMappings: [{ from: 'a', to: 'session.idle' }] }, CANONICAL)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/event-mapper.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
/**
 * 插件事件映射执行器 —— 原生事件 → canonical 事件（纯数据表驱动）。
 * 设计：docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md
 * 匹配优先级：eventMappings（数组顺序）→ canonical 直发 passthrough → transformEvent → 丢弃+遥测。
 */
import { getPath, evalConditions, renderTemplate, setPath, Condition } from './path-expr';

export type FieldValue =
  | { path: string; default?: unknown }
  | { const: unknown }
  | { template: string };

export interface EventMapping {
  from: string | string[];
  /** canonical 类型，或 'drop' 显式丢弃 */
  to: string;
  when?: Condition[];
  fields?: Record<string, FieldValue>;
}

export interface EventSourceShape {
  typePath: string;
  sessionIdPath?: string;
  directoryPath?: string;
}

export type TransformEventFn = (raw: any) => any | any[] | null;

export interface EventMappingEntry {
  eventSource?: EventSourceShape;
  eventMappings?: EventMapping[];
  transformEvent?: TransformEventFn;
}

/** sessionID 注入约定：与 pi 现状输出逐字节对齐（message.part.updated 进 part，其余进 properties）。 */
const SESSION_ID_TARGETS: Record<string, 'part' | 'properties'> = {
  'message.part.updated': 'part',
};

function evalField(v: FieldValue, raw: any): unknown {
  if ('const' in v) return v.const;
  if ('template' in v) return renderTemplate(v.template, raw);
  const got = getPath(raw, v.path);
  return got ?? v.default; // nullish 语义（对齐 pi 现状 delta ?? ''）
}

export function applyEventMappings(
  raw: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  onUnknown?: (t: string) => void,
): any[] {
  const source = entry.eventSource;
  const nativeType: unknown = source ? getPath(raw, source.typePath) : undefined;
  // 已 canonical 信封（如 pi push 的 permission.asked）或畸形事件 → 原样透传，
  // 下游 normalize/畸形诊断各自处理。
  if (typeof nativeType !== 'string' || !nativeType) return [raw];

  const sessionID = source?.sessionIdPath ? getPath(raw, source.sessionIdPath) : undefined;
  const directory = source?.directoryPath ? getPath(raw, source.directoryPath) : undefined;

  for (const m of entry.eventMappings ?? []) {
    const froms = Array.isArray(m.from) ? m.from : [m.from];
    if (!froms.includes(nativeType)) continue;
    if (!evalConditions(m.when, raw)) continue;
    if (m.to === 'drop') return [];
    const properties: Record<string, any> = {};
    for (const [key, fv] of Object.entries(m.fields ?? {})) {
      const v = evalField(fv, raw);
      if (v !== undefined) setPath(properties, key, v); // 路径不存在 → 字段不创建
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

  if (isCanonicalType(nativeType)) return [raw]; // 插件直发 canonical 类型

  if (entry.transformEvent) {
    const out = entry.transformEvent(raw);
    if (out === null || out === undefined) return [];
    return Array.isArray(out) ? out : [out];
  }

  onUnknown?.(nativeType);
  return [];
}

export function validateEventMappings(entry: EventMappingEntry, canonicalTypes: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  if (entry.eventMappings && entry.eventMappings.length > 0 && !entry.eventSource?.typePath) {
    issues.push('eventMappings declared but eventSource.typePath is missing');
  }
  for (const m of entry.eventMappings ?? []) {
    if (!m.from || (Array.isArray(m.from) && m.from.length === 0)) issues.push(`mapping to '${m.to}': empty from`);
    if (m.to !== 'drop' && !canonicalTypes.has(m.to)) issues.push(`mapping '${m.from}' → unknown canonical type '${m.to}'`);
    for (const [key, fv] of Object.entries(m.fields ?? {})) {
      if ('path' in fv && !/^\$/.test(fv.path)) issues.push(`mapping '${m.from}' field '${key}': bad path '${fv.path}'`);
      if ('template' in fv && !/\{\$[^}]*\}/.test(fv.template)) issues.push(`mapping '${m.from}' field '${key}': template has no interpolation`);
    }
    for (const c of m.when ?? []) {
      if (!/^\$/.test(c.path)) issues.push(`mapping '${m.from}' when: bad path '${c.path}'`);
    }
  }
  return issues;
}

/** 包装 runtime.global.event()：声明了 eventMappings 的 runtime，其原生流在此过表。 */
export function wrapGlobalEventStream(
  rt: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  onUnknown?: (t: string) => void,
): void {
  if (!entry.eventMappings || entry.eventMappings.length === 0) return;
  const orig = rt.global.event.bind(rt.global);
  rt.global.event = async () => {
    const result = await orig();
    const stream = result?.stream ?? result;
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return result;
    const mapped = (async function* () {
      for await (const raw of stream) {
        for (const evt of applyEventMappings(raw, entry, isCanonicalType, onUnknown)) yield evt;
      }
    })();
    return result?.stream ? { ...result, stream: mapped } : mapped;
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/runtime/event-mapper.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-mapper.ts gateway/tests/unit/runtime/event-mapper.test.ts
git commit -m "feat(runtime): declarative plugin event mapping executor + validator + stream wrapper"
```

---

### Task 3: CanonicalFacetTable（facet 规则表 + 执行器）

**Files:**
- Create: `gateway/src/runtime/canonical-facets.ts`
- Test: `gateway/tests/unit/runtime/canonical-facets.test.ts`

**Interfaces:**
- Consumes: Task 1 `getPath/evalConditions/Condition`；`normalize.ts` 的 `EventFacets/StepEndedProps/ApprovalFacet` 类型
- Produces（Task 4 依赖）:
  - `interface FacetRule { type; when?; step?; chatSignal?; deltaText?; chatError?; broadcast?; compaction?; approval? }`（step 的 `sessionID` 允许 `string[]` 多路径回退；`requiresSessionID?: boolean` 仅 legacy 行）
  - `CANONICAL_FACET_RULES: FacetRule[]`
  - `evaluateFacetRules(rules: FacetRule[], type: string, props: any, chainSessionID: string | undefined): Pick<EventFacets, 'step'|'chatSignal'|'deltaText'|'chatError'|'broadcast'|'compaction'|'approval'>`

**执行语义（与 normalize.ts 现状逐点等价的转译规则）**：
- 逐行扫描，**每个 facet 字段取首个命中**（行序 = 优先级）
- step 构造：`sessionID` 多路径取首个 truthy；`requiresSessionID` 行（仅 `session.next.step.ended`）结果 falsy 时**回退 chainSessionID 并以此判定是否产出**；非标记行严格只用声明路径（可能 undefined——与现状 `stepPropsFromPartUpdated` 一致）
- chatError：取路径值后执行器内置 `|| 'Unknown error'`（对齐现状）
- approval：fire 条件 = chainSessionID 且 requestId 且 toolName；`metadata` 构造（`props.metadata ?? (args||risk ? {args, risk} : undefined)`）为执行器内置特例，注释说明
- toolCommand **不在表内**（依赖信封 payload.args + `type.includes('tool')`，保留在 normalize.ts 内联，注释说明）

- [ ] **Step 1: 写失败测试**

```ts
import { CANONICAL_FACET_RULES, evaluateFacetRules } from '../../../src/runtime/canonical-facets';

const ev = (type: string, props: any, sid?: string) => evaluateFacetRules(CANONICAL_FACET_RULES, type, props, sid);

test('step: legacy session.next.step.ended（chain sessionID 回退 + 必须）', () => {
  expect(ev('session.next.step.ended', { assistantMessageID: 'm1' }, 's1').step)
    .toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: undefined });
  expect(ev('session.next.step.ended', {}, undefined).step).toBeNull();
});

test('step: step-finish part（严格 part 路径，无 chain 回退）', () => {
  const r = ev('message.part.updated', { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } }, 's1');
  expect(r.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
  // part.sessionID 缺席时不回退 chain（现状 stepPropsFromPartUpdated 语义）
  const r2 = ev('message.part.updated', { part: { type: 'step-finish', messageID: 'm1' } }, 'sChain');
  expect(r2.step).toEqual({ sessionID: undefined, assistantMessageID: 'm1', finish: undefined });
});

test('step: completed assistant message', () => {
  const r = ev('message.updated', { info: { role: 'assistant', time: { completed: 1 }, sessionID: 's1', id: 'm1', finish: 'stop' } }, 's1');
  expect(r.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
  expect(ev('message.updated', { info: { role: 'user', time: { completed: 1 } } }, 's1').step).toBeNull();
});

test('chatSignal: delta 双路径（part.text 优先于 delta；空串不算）', () => {
  expect(ev('message.part.updated', { part: { text: 'a' }, delta: 'b' }, undefined).deltaText).toBe('a');
  expect(ev('message.part.updated', { part: { text: '' }, delta: 'b' }, undefined).deltaText).toBe('b');
  expect(ev('message.part.updated', { part: {} }, undefined).chatSignal).toBeNull();
});

test('chatSignal: complete/error + broadcast', () => {
  expect(ev('session.idle', {}, 's1')).toMatchObject({ chatSignal: 'complete', broadcast: 'idle' });
  expect(ev('session.error', { error: 'x' }, 's1')).toMatchObject({ chatSignal: 'error', chatError: 'x', broadcast: 'error' });
  expect(ev('message.error', {}, 's1')).toMatchObject({ chatSignal: 'error', chatError: 'Unknown error', broadcast: 'passthrough' });
  expect(ev('session.created', {}, 's1').broadcast).toBe('passthrough');
});

test('compaction', () => {
  expect(ev('session.compacting', {}, 's1').compaction).toBe('start');
  expect(ev('session.compacted', {}, 's1').compaction).toBe('end');
  expect(ev('session.idle', {}, 's1').compaction).toBeNull();
});

test('approval: 双形状对齐 + 畸形不产', () => {
  const a = ev('permission.asked', { id: 'r1', permission: 'bash', patterns: ['*'] }, 's1').approval;
  expect(a).toMatchObject({ requestId: 'r1', toolName: 'bash' });
  const b = ev('permission.asked', { requestId: 'r2', toolName: 'edit', args: { f: 1 }, risk: 'high' }, 's1').approval;
  expect(b).toMatchObject({ requestId: 'r2', toolName: 'edit', metadata: { args: { f: 1 }, risk: 'high' } });
  expect(ev('permission.asked', { requestId: 'r3' }, 's1').approval).toBeNull(); // 缺 toolName
  expect(ev('permission.asked', { requestId: 'r4', toolName: 'bash' }, undefined).approval).toBeNull(); // 缺 chain sid
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/canonical-facets.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
/**
 * CanonicalFacetTable —— canonical 事件类型 → EventFacets 的纯数据规则表。
 * 初始内容 = normalizeOpencodeEvent（normalize.ts）if 链的逐行表化；
 * opencode 知识与执行机制分离，v2/新 runtime 落地时只加规则行。
 */
import { getPath, evalConditions, Condition } from './path-expr';
import type { EventFacets, StepEndedProps, ApprovalFacet } from './normalize';

export interface FacetRule {
  type: string;
  when?: Condition[];
  step?: {
    /** string[] = 多路径回退（取首个 truthy） */
    sessionID: string | string[];
    assistantMessageID: string;
    finish: string;
    /** 仅 legacy 行：sessionID 解析失败时回退 chain 并以此判定是否产出 */
    requiresSessionID?: boolean;
  };
  chatSignal?: 'delta' | 'complete' | 'error';
  deltaText?: string;
  chatError?: string;
  broadcast?: 'idle' | 'error' | 'passthrough';
  compaction?: 'start' | 'end';
  approval?: { requestId: string | string[]; toolName: string | string[]; patterns?: string };
}

export const CANONICAL_FACET_RULES: FacetRule[] = [
  // step 三载体（行序 = normalize.ts if 链顺序）
  { type: 'session.next.step.ended',
    step: { sessionID: ['$.sessionID', '$.part.sessionID', '$.info.sessionID'], assistantMessageID: '$.assistantMessageID', finish: '$.finish', requiresSessionID: true } },
  { type: 'message.part.updated', when: [{ path: '$.part.type', equals: 'step-finish' }],
    step: { sessionID: '$.part.sessionID', assistantMessageID: '$.part.messageID', finish: '$.part.reason' } },
  { type: 'message.updated',
    when: [{ path: '$.info.role', equals: 'assistant' }, { path: '$.info.time.completed', exists: true }],
    step: { sessionID: '$.info.sessionID', assistantMessageID: '$.info.id', finish: '$.info.finish' } },
  // chatSignal（delta 双路径：part.text 优先）
  { type: 'message.part.updated', when: [{ path: '$.part.text', exists: true }], chatSignal: 'delta', deltaText: '$.part.text' },
  { type: 'message.part.updated', when: [{ path: '$.delta', exists: true }], chatSignal: 'delta', deltaText: '$.delta' },
  { type: 'session.idle', chatSignal: 'complete', broadcast: 'idle' },
  { type: 'message.updated', chatSignal: 'complete' },
  { type: 'session.error', chatSignal: 'error', chatError: '$.error', broadcast: 'error' },
  { type: 'message.error', chatSignal: 'error', chatError: '$.error' },
  // compaction
  { type: 'session.compacting', compaction: 'start' },
  { type: 'session.compacted', compaction: 'end' },
  // approval 双形状对齐；metadata 构造为执行器内置特例
  { type: 'permission.asked',
    approval: { requestId: ['$.requestId', '$.id'], toolName: ['$.permission', '$.toolName'], patterns: '$.patterns' } },
];

type FacetSubset = Pick<EventFacets, 'step' | 'chatSignal' | 'deltaText' | 'chatError' | 'broadcast' | 'compaction' | 'approval'>;

function firstTruthy(paths: string | string[], props: any): unknown {
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    const v = getPath(props, p);
    if (v) return v;
  }
  return undefined;
}

export function evaluateFacetRules(rules: FacetRule[], type: string, props: any, chainSessionID: string | undefined): FacetSubset {
  const out: FacetSubset = { step: null, chatSignal: null, deltaText: undefined, chatError: undefined, broadcast: 'passthrough', compaction: null, approval: null };
  for (const r of rules) {
    if (r.type !== type) continue;
    if (!evalConditions(r.when, props)) continue;
    if (!out.step && r.step) {
      let sid = firstTruthy(r.step.sessionID, props) as string | undefined;
      if (r.step.requiresSessionID) {
        sid = sid || chainSessionID;
        if (!sid) continue; // legacy 行：无 sessionID 不产 step
      }
      out.step = { sessionID: sid, assistantMessageID: getPath(props, r.step.assistantMessageID) as string | undefined, finish: getPath(props, r.step.finish) as string | undefined } as StepEndedProps;
    }
    if (!out.chatSignal && r.chatSignal) {
      out.chatSignal = r.chatSignal;
      if (r.deltaText) out.deltaText = getPath(props, r.deltaText) as string | undefined;
      if (r.chatError) out.chatError = getPath(props, r.chatError) || 'Unknown error'; // 内置：对齐现状 `|| 'Unknown error'`
    }
    if (out.broadcast === 'passthrough' && r.broadcast) out.broadcast = r.broadcast;
    if (!out.compaction && r.compaction) out.compaction = r.compaction;
    if (!out.approval && r.approval && chainSessionID) {
      const requestId = firstTruthy(r.approval.requestId, props);
      const toolName = firstTruthy(r.approval.toolName, props);
      if (requestId && toolName) {
        // metadata 构造（props.metadata ?? {args, risk}）为执行器内置特例——
        // 对象构造非纯路径表达，属 canonical approval 信封约定。
        const metadata = props?.metadata ?? (props?.args !== undefined || props?.risk !== undefined
          ? { args: props?.args, risk: props?.risk } : undefined);
        const patterns = r.approval.patterns ? getPath(props, r.approval.patterns) : undefined;
        out.approval = { requestId: String(requestId), toolName: String(toolName), patterns: Array.isArray(patterns) ? patterns : [], metadata } as ApprovalFacet;
      }
    }
  }
  return out;
}
```

注意 `continue` 在 `requiresSessionID` 行的语义：跳过该行继续后续行（对齐现状 if-else 链"条件不满足落到下一分支"）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/runtime/canonical-facets.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/canonical-facets.ts gateway/tests/unit/runtime/canonical-facets.test.ts
git commit -m "feat(runtime): canonical facet rule table (normalize if-chain datafied)"
```

---

### Task 4: normalizeOpencodeEvent 重构 + oracle 对照测试

**Files:**
- Modify: `gateway/src/runtime/normalize.ts:97-163`（normalizeOpencodeEvent 函数体）
- Test: `gateway/tests/unit/runtime/normalize-oracle.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 `evaluateFacetRules/CANONICAL_FACET_RULES`
- Produces: `normalizeOpencodeEvent` 签名与返回形状不变（`RawRuntimeEvent → EventFacets`）

**策略**：旧 if 链实现**完整复制进 oracle 测试文件**（命名 `legacyNormalizeForOracle`），fixture 语料上断言新旧输出 `toEqual` 全等。绿灯后源码里删除旧 if 链（oracle 永驻测试文件）。

- [ ] **Step 1: 写 oracle 测试（先复制 legacy 实现进测试文件）**

```ts
import { normalizeOpencodeEvent, EventFacets } from '../../../src/runtime/normalize';

// —— oracle：重构前 normalizeOpencodeEvent 的逐字拷贝（2026-10-08 版本）——
function legacyNormalizeForOracle(evt: any): EventFacets {
  const payload = evt?.payload || {};
  const type = payload?.type || evt?.type || '';
  const props = payload?.properties || evt?.properties || {};
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;
  let step: any = null;
  if (type === 'session.next.step.ended' && sessionID) {
    step = { sessionID, assistantMessageID: props?.assistantMessageID, finish: props?.finish };
  } else if (type === 'message.part.updated') {
    const part = props?.part;
    if (part && part.type === 'step-finish') step = { sessionID: part.sessionID, assistantMessageID: part.messageID, finish: part.reason };
  } else if (type === 'message.updated') {
    const info = props?.info;
    if (info && info.role === 'assistant' && info.time?.completed) step = { sessionID: info.sessionID, assistantMessageID: info.id, finish: info.finish };
  }
  let chatSignal: any = null, deltaText: string | undefined, chatError: unknown;
  if (type === 'message.part.updated') {
    const text = props?.part?.text || props?.delta || '';
    if (text) { deltaText = text; chatSignal = 'delta'; }
  } else if (type === 'session.idle' || type === 'message.updated') {
    chatSignal = 'complete';
  } else if (type === 'session.error' || type === 'message.error') {
    chatSignal = 'error'; chatError = props?.error || 'Unknown error';
  }
  const broadcast: any = type === 'session.idle' ? 'idle' : type === 'session.error' ? 'error' : 'passthrough';
  const toolArgs = props?.args || props?.info?.args || payload?.args;
  const command = typeof toolArgs?.command === 'string' ? toolArgs.command : '';
  const toolCommand = command && type.includes('tool') ? command : undefined;
  const compaction: any = type === 'session.compacting' ? 'start' : type === 'session.compacted' ? 'end' : null;
  let approval: any = null;
  if (type === 'permission.asked' && sessionID) {
    const requestId = props?.requestId ?? props?.id;
    const toolName = props?.permission ?? props?.toolName;
    if (requestId && toolName) {
      approval = { requestId: String(requestId), toolName: String(toolName),
        patterns: Array.isArray(props?.patterns) ? props.patterns : [],
        metadata: props?.metadata ?? (props?.args !== undefined || props?.risk !== undefined ? { args: props?.args, risk: props?.risk } : undefined) };
    }
  }
  return { type, properties: props, sessionID, directory: evt?.directory, step, chatSignal, deltaText, chatError, broadcast, compaction, toolCommand, approval };
}

// —— fixture 语料：每条 facet 路径 + 边界样本 ——
const FIXTURES: Array<[string, any]> = [
  ['legacy step.ended', { payload: { type: 'session.next.step.ended', properties: { sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' } } }],
  ['legacy step.ended 无 sid', { payload: { type: 'session.next.step.ended', properties: {} } }],
  ['step-finish part', { payload: { type: 'message.part.updated', properties: { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } } } }],
  ['step-finish part 缺 part.sessionID', { payload: { type: 'message.part.updated', properties: { part: { type: 'step-finish', messageID: 'm1' } } } }],
  ['text part', { payload: { type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hello' } } } }],
  ['text part 空串 + delta 回退', { payload: { type: 'message.part.updated', properties: { part: { type: 'text', text: '' }, delta: 'd' } } }],
  ['part.updated 无文本', { payload: { type: 'message.part.updated', properties: { part: { type: 'tool-call', sessionID: 's1' } } } }],
  ['completed assistant', { payload: { type: 'message.updated', properties: { info: { role: 'assistant', time: { completed: 1 }, sessionID: 's1', id: 'm1', finish: 'stop' } } } }],
  ['incomplete assistant', { payload: { type: 'message.updated', properties: { info: { role: 'assistant', sessionID: 's1', id: 'm1' } } } }],
  ['user message.updated', { payload: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 's1' } } } }],
  ['session.idle', { payload: { type: 'session.idle', properties: { sessionID: 's1' } } }],
  ['session.error', { payload: { type: 'session.error', properties: { sessionID: 's1', error: new Error('boom').message } } }],
  ['session.error 无 error', { payload: { type: 'session.error', properties: { sessionID: 's1' } } }],
  ['message.error', { payload: { type: 'message.error', properties: { sessionID: 's1', error: 'x' } } }],
  ['compacting', { payload: { type: 'session.compacting', properties: { sessionID: 's1' } } }],
  ['compacted', { payload: { type: 'session.compacted', properties: { sessionID: 's1' } } }],
  ['tool command（type includes tool）', { payload: { type: 'session.next.tool.executed', properties: { sessionID: 's1', args: { command: 'npm test' } } } }],
  ['非 tool 类型带 command 不提取', { payload: { type: 'message.updated', properties: { sessionID: 's1', args: { command: 'x' }, info: { role: 'user' } } } }],
  ['payload.args 路径', { payload: { type: 'tool.call', args: { command: 'ls' }, properties: {} } }],
  ['permission.asked opencode 形状', { payload: { type: 'permission.asked', properties: { sessionID: 's1', id: 'r1', permission: 'bash', patterns: ['git *'] } } }],
  ['permission.asked pi 形状', { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r2', toolName: 'edit', args: { f: 1 }, risk: 'low' } } }],
  ['permission.asked 畸形', { payload: { type: 'permission.asked', properties: { sessionID: 's1' } } }],
  ['permission.asked 无 sid', { payload: { type: 'permission.asked', properties: { id: 'r3', permission: 'bash' } } }],
  ['passthrough 类型', { payload: { type: 'session.created', properties: { info: { id: 's1', title: 't' } } } }],
  ['裸事件（无 payload 信封）', { type: 'session.idle', properties: { sessionID: 's1' } }],
  ['裸事件 + 顶层 sessionID', { type: 'session.idle', sessionID: 's9' }],
  ['空 type', { payload: { properties: {} } }],
  ['directory 透传', { directory: '/proj', payload: { type: 'session.updated', properties: { sessionID: 's1' } } }],
];

describe('oracle: table-driven ≡ legacy if-chain', () => {
  test.each(FIXTURES)('%s', (_name, evt) => {
    expect(normalizeOpencodeEvent(evt)).toEqual(legacyNormalizeForOracle(evt));
  });
});
```

- [ ] **Step 2: 跑测试（重构前应先全绿——oracle 与现状等价性自证）**

Run: `cd gateway; npx jest tests/unit/runtime/normalize-oracle.test.ts --runInBand`
Expected: PASS（当前实现 vs oracle）。若有 fixture 失败 = fixture 写错，修 fixture 不是改实现。

- [ ] **Step 3: 重构 normalizeOpencodeEvent 为查表**

normalize.ts 中替换函数体（保留信封解包、sessionID 链、toolCommand 内联）：

```ts
export function normalizeOpencodeEvent(evt: RawRuntimeEvent): EventFacets {
  const payload = evt?.payload || {};
  const type = payload?.type || evt?.type || '';
  const props = payload?.properties || evt?.properties || {};
  // sessionID 五层提取链：信封约定（非 facet 规则），执行器内置。
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;

  const facets = evaluateFacetRules(CANONICAL_FACET_RULES, type, props, sessionID);

  // toolCommand：type.includes('tool') + 信封 payload.args 依赖，表化不了——
  // 执行器内置特例（spec §5）。
  const toolArgs = props?.args || props?.info?.args || payload?.args;
  const command = typeof toolArgs?.command === 'string' ? toolArgs.command : '';
  const toolCommand = command && type.includes('tool') ? command : undefined;

  return { type, properties: props, sessionID, directory: evt?.directory, toolCommand, ...facets };
}
```

文件头 import 增加：`import { CANONICAL_FACET_RULES, evaluateFacetRules } from './canonical-facets';`
删除 `stepPropsFromPartUpdated`/`stepPropsFromMessageUpdated`（若无其他引用——先 grep 确认；dry-event.ts 只用 normalizeOpencodeEvent）。

- [ ] **Step 4: oracle + 存量 normalize 相关测试全绿**

Run: `cd gateway; npx jest tests/unit/runtime/ --runInBand`
Expected: PASS（oracle + event-flow-matrix + pi-events 等全绿）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/normalize.ts gateway/tests/unit/runtime/normalize-oracle.test.ts
git commit -m "refactor(runtime): normalizeOpencodeEvent becomes table-driven (oracle-verified equivalence)"
```

---

### Task 5: loader/registerBuiltin/validate 扩展 + index.ts 流包装接线

**Files:**
- Modify: `gateway/src/runtime/loader.ts`（meta/state/注册带 event 字段；loadFile 校验）
- Modify: `gateway/src/runtime/validate.ts`（或 loader 内联校验调用）
- Modify: `gateway/src/index.ts`（createRuntime 包装 + onUnknown 遥测接线）
- Test: `gateway/tests/unit/runtime/loader-event-mappings.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 `EventMappingEntry/validateEventMappings/wrapGlobalEventStream/applyEventMappings`
- Produces:
  - `RuntimePluginLoader.registerBuiltin(name, factory, capabilities, external, extras?: EventMappingEntry): void`
  - `loader.get(name)` 返回增加 `eventSource?/eventMappings?/transformEvent?`
  - index.ts 内部：`canonicalTypeSet`（EVENT_FLOW_MATRIX keys + RUNTIME_NATIVE_DROPPED 的 Set）

- [ ] **Step 1: 写失败测试（loader 校验 + 端到端包装）**

```ts
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { applyEventMappings, wrapGlobalEventStream, validateEventMappings } from '../../../src/runtime/event-mapper';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makePluginDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-loader-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('声明 eventMappings 的插件：加载后 meta 带映射；未知 canonical to → error + eventStream 降级', async () => {
  const dir = makePluginDir({
    'good.js': `module.exports = { name: 'good', capabilities: { eventStream: true },
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'done', to: 'session.idle' }],
      async createRuntime() { return { name: 'good', capabilities: { eventStream: true } }; } };`,
    'bad.js': `module.exports = { name: 'bad', capabilities: { eventStream: true },
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'x', to: 'not.a.type' }],
      async createRuntime() { return { name: 'bad', capabilities: { eventStream: true } }; } };`,
  });
  const loader = new RuntimePluginLoader(dir);
  await loader.scan();
  const good = loader.get('good');
  expect(good?.eventMappings).toHaveLength(1);
  const bad = loader.get('bad');
  expect(bad?.capabilities.eventStream).toBe(false); // 降级
  const state = loader.getState().find((s) => s.name === 'bad');
  expect(state?.status).toBe('error');
});

test('wrapGlobalEventStream 端到端：原生进 canonical 出，drop/未知/passthrough 各就各位', async () => {
  const natives = [
    { type: 'done', sessionID: 's1' },
    { type: 'noise', sessionID: 's1' },
    { type: 'mystery' },
    { payload: { type: 'permission.asked', properties: { sessionID: 's1' } } }, // 已 canonical 信封
  ];
  const rt: any = { global: { event: async () => ({ stream: (async function* () { for (const n of natives) yield n; })() }) } };
  const unknown: string[] = [];
  const CANON = new Set(['session.idle', 'permission.asked']);
  wrapGlobalEventStream(rt, {
    eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
    eventMappings: [{ from: 'done', to: 'session.idle' }, { from: 'noise', to: 'drop' }],
  }, (t) => CANON.has(t), (t) => unknown.push(t));
  const { stream } = await rt.global.event();
  const out: any[] = [];
  for await (const e of stream) out.push(e);
  expect(out).toHaveLength(2);
  expect(out[0].payload.type).toBe('session.idle');
  expect(out[1].payload.type).toBe('permission.asked');
  expect(unknown).toEqual(['mystery']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/loader-event-mappings.test.ts --runInBand`
Expected: FAIL（loader.get 无 eventMappings 字段）

- [ ] **Step 3: 实现**

loader.ts：
- `RuntimeFactory` 旁加 meta：`meta = Map<string, {capabilities, external} & EventMappingEntry>`
- `registerBuiltin(name, factory, capabilities, external, extras?: EventMappingEntry)`——extras 存入 builtins
- `loadFile`：`mod.eventSource/eventMappings/transformEvent` 透传进 meta；`validateEventMappings` 失败 → `state.status='error'`（记 issues join）+ `capabilities.eventStream=false`，**仍注册**（fail-open）
- `get()` 返回展开 event 字段
- canonicalTypes 入参从哪来：loader 不 import 矩阵（避免循环）——`validateEventMappings` 的 canonicalTypes 参数由 index.ts 构造 loader 时注入？改 loader 构造函数签名会破坏现有调用。**方案**：loader 新增 `setCanonicalTypes(types: ReadonlySet<string>)`，index.ts 在构造后调用；测试里直接传。

index.ts：
- 模块级：`const CANONICAL_TYPE_SET = new Set([...Object.keys(EVENT_FLOW_MATRIX), ...RUNTIME_NATIVE_DROPPED])`（import 自 event-flow-matrix.ts）
- loader 构造后 `this.runtimeLoader.setCanonicalTypes(CANONICAL_TYPE_SET)`
- `createRuntime` 里 plugin.createRuntime 成功后：
```ts
const entryMeta = this.runtimeLoader?.get(pluginName);
if (entryMeta?.eventMappings?.length) {
  wrapGlobalEventStream(rt, entryMeta, (t) => CANONICAL_TYPE_SET.has(t), (t) => {
    try {
      const { firstSeen } = this.unknownEventTracker.record(rt.name, t);
      if (firstSeen) log.warn(`[SSE] runtime '${rt.name}' native event '${t}' unmapped — dropped (declare in eventMappings or transformEvent)`);
    } catch { /* fail-open */ }
  });
}
```
（内置 opencode 无 mappings → 不包装，零风险。）

- [ ] **Step 4: 测试 + build（index.ts 改了必须 build）**

Run: `cd gateway; npx jest tests/unit/runtime/loader-event-mappings.test.ts --runInBand`
Expected: PASS
Run: `npm run build`（root）
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/src/runtime/validate.ts gateway/src/index.ts gateway/tests/unit/runtime/loader-event-mappings.test.ts
git commit -m "feat(runtime): loader declares eventMappings + gateway stream wrapping (plugin-native events enter canonical pipeline)"
```

---

### Task 6: pi 迁入映射表（消灭 translatePiEvent 手写 switch）+ turn_end bug 修复

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts`（全量重写）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（registerBuiltin 传 extras；PiEventStream 发原生事件）
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`（改造，见下）

**Interfaces:**
- Consumes: Task 2 全部 + Task 5 的 registerBuiltin extras
- Produces: `PI_EVENT_SOURCE: EventSourceShape`、`PI_EVENT_MAPPINGS: EventMapping[]`、`piTransformEvent: TransformEventFn`（permission.asked/replied 双 case，逐字保留现形状）

**迁移要点**：
- `PiEventStream.onEvent`：resolve sessionID 后**发原生事件** `{ ...event, sessionID }`（不再翻译）；`push()` 不变（canonical 直推，wrapper passthrough）
- `translatePiEvent` 删除。测试改造：本地 helper 复现旧签名——断言（期望值）**零修改**，仅两处披露的例外：
  1. `turn_end` 期望的 part 字段 `assistantMessageID: 'pi_step_s1'` → **`messageID: 'pi_step_s1'`**（bug 修复，facet 规则读 `$.part.messageID`——pi 上 BudgetGuard step 首次真正生效）
  2. permission.asked/replied 走 `piTransformEvent`，输出形状逐字保留现实现（这两条断言应零修改——若现测试输入形状与 transform 实现冲突，按现状输出为准调整 helper）
- 新增钉扎测试：turn_end 经完整链（applyEventMappings → normalizeOpencodeEvent）产出非空 `step` facet 且 `assistantMessageID === 'pi_step_s1'`

- [ ] **Step 1: 读现有测试，改造 harness**

先读 `gateway/tests/unit/runtime/pi-events.test.ts` 全文。测试文件顶部加 helper：

```ts
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { PI_EVENT_SOURCE, PI_EVENT_MAPPINGS, piTransformEvent } from '../../../src/runtime/pi/pi-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';

const CANON = new Set(Object.keys(EVENT_FLOW_MATRIX));
function translatePiEvent(event: any, sessionID: string) {
  return applyEventMappings({ ...event, sessionID }, {
    eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent,
  }, (t) => CANON.has(t))[0] ?? null;
}
```

断言批量核对：映射产物的 envelope 是 `{ payload: { type, properties }, sessionID, directory }`——若旧断言用 `toEqual({payload:{...}})` 精确匹配，helper 里收窄返回 `{ payload: out[0].payload }` 使断言零修改。permission 两条若输出不一致，调整 `piTransformEvent` 直到逐字一致。

- [ ] **Step 2: 写新钉扎测试（先红）**

```ts
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

test('turn_end 全链：step facet 产出且 messageID 对齐（bug 修复钉扎）', () => {
  const mapped = translatePiEvent({ type: 'turn_end' }, 's1');
  expect((mapped as any).payload.properties.part.messageID).toBe('pi_step_s1');
  const facets = normalizeOpencodeEvent(mapped);
  expect(facets.step).toEqual({ sessionID: 's1', assistantMessageID: 'pi_step_s1', finish: undefined });
});
```

Run: `cd gateway; npx jest tests/unit/runtime/pi-events.test.ts --runInBand`
Expected: FAIL（PI_EVENT_MAPPINGS 不存在）

- [ ] **Step 3: 重写 pi-events.ts**

```ts
import type { RawRuntimeEvent } from '../normalize';
import type { EventMapping, EventSourceShape, TransformEventFn } from '../event-mapper';

/** pi 原生事件源形状：session.subscribe 事件顶层 type；sessionID 由 PiEventStream 解析后附上。 */
export const PI_EVENT_SOURCE: EventSourceShape = { typePath: '$.type', sessionIdPath: '$.sessionID' };

/** pi 原生事件 → canonical（声明式，原 translatePiEvent switch 的表化）。
 *  turn_end 写 part.messageID（修复：facet 规则读 messageID 而非 assistantMessageID，
 *  pi 上 BudgetGuard step 此前从未触发）。 */
export const PI_EVENT_MAPPINGS: EventMapping[] = [
  { from: 'agent_start', to: 'session.updated' },
  { from: ['message_start', 'message_update'], to: 'message.part.updated',
    fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } } },
  { from: 'message_end', to: 'message.updated', fields: { 'info.role': { const: 'assistant' } } },
  { from: 'tool_call', to: 'message.part.updated', fields: { 'part.type': { const: 'tool-call' } } },
  { from: 'tool_result', to: 'message.part.updated', fields: { 'part.type': { const: 'tool-result' } } },
  { from: 'turn_start', to: 'message.part.updated', fields: { 'part.type': { const: 'step-start' } } },
  { from: 'turn_end', to: 'message.part.updated',
    fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } } },
  { from: ['agent_end', 'agent_settled'], to: 'session.idle' },
];

/** 逃逸口：permission.asked/replied 已 canonical 形状，逐字保留现输出（双 runtime 形状对齐在 facet 表）。 */
export const piTransformEvent: TransformEventFn = (event: any): RawRuntimeEvent | null => {
  const t = event?.type ?? event?.payload?.type;
  if (t === 'permission.asked') {
    return { payload: { type: 'permission.asked', properties: {
      sessionID: event.payload.properties.sessionID,
      requestId: event.payload.properties.requestId,
      toolName: event.payload.properties.toolName,
      args: event.payload.properties.args,
      risk: event.payload.properties.risk,
    } } };
  }
  if (t === 'permission.replied') {
    return { payload: { type: 'permission.replied', properties: {
      sessionID: event.payload.properties.sessionID,
      requestId: event.payload.properties.requestId,
      approved: event.payload.properties.approved,
    } } };
  }
  return null;
};
```

注意：permission 两个 case 的输入**没有 sessionID 顶层字段**（从 payload.properties 读），所以走 transform 而非映射表（它们的原生形状已是 canonical envelope——按 wrapper 规则 1，无 `$.type` 顶层时原样 passthrough；但 pi 原生 permission 事件顶层带 `type`……实现时先跑测试确认走哪条路，目标是输出逐字一致，两条路都可达）。

PiEventStream.onEvent 改为：
```ts
this.onEvent = (evt: any) => {
  const id = this.resolveSessionId(evt?.session);
  if (!id) return;
  const native = { ...evt, sessionID: id };
  for (const l of this.listeners) l(native);
};
```

pi-runtime.ts：`registerBuiltin('pi', ...)` 调用处传 extras `{ eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent }`（找到 index.ts 里 pi 的 registerBuiltin 调用点修改；若 pi 是 createRuntime 工厂自带，则改为在工厂返回对象上附加并在 Task 5 的 meta 合并处透传——**以实现时读到的注册路径为准**）。

- [ ] **Step 4: pi 测试 + runtime 测试目录全绿 + build**

Run: `cd gateway; npx jest tests/unit/runtime/ --runInBand; npx jest tests/unit/gateway/pi-adapter.test.ts --runInBand`
Expected: PASS
Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: 全量回归**

Run: `cd gateway; npx jest --runInBand`
Expected: 全绿（235+ 套件；pi 相关集成测试若断言 PiEventStream 输出形状，按新原生形状更新 harness——只许改 harness 不许改语义断言）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/pi/pi-events.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/src/index.ts gateway/tests/unit/runtime/pi-events.test.ts
git commit -m "refactor(pi): translatePiEvent switch -> declarative eventMappings; fix turn_end step facet (part.messageID)"
```

---

### Task 7: dry-event 试衣间扩展（+ approval facet 回显补漏）

**Files:**
- Modify: `gateway/src/routes/dry-event.ts`
- Modify: `gateway/src/index.ts`（dry-event 路由注册 deps 加 `getPluginEventEntry`）
- Test: `gateway/tests/unit/routes/dry-event.test.ts`（扩展或新建）

**Interfaces:**
- Consumes: Task 2 `applyEventMappings`、Task 5 loader meta
- Produces: dry-event deps 增加 `getPluginEventEntry?: (name: string) => EventMappingEntry | null`；响应增加 `mapping` 跳与 `facets.approval`

- [ ] **Step 1: 写失败测试**

```ts
// POST /api/runtime/dry-event { plugin: 'fake', event: { type: 'done', sessionID: 's1' } }
// → 200 { mapping: { matched: true, to: 'session.idle' }, type: 'session.idle', facets: {...}, flow: {...}, warnings: [...] }
// { plugin: 'fake', event: { type: 'mystery' } } → mapping: { matched: false, dropped: true }
// { plugin: 'nonexistent' } → 400 { error } 列出可用插件名
// 无 plugin 字段 → 行为与现状一致（直接进入 normalize）
// facets 输出包含 approval 字段（补漏：现状 facets 回显缺 approval）
```

（测试形状对齐 `gateway/tests/unit/routes/` 现有 dry-event 测试的 deps 注入模式——先读该文件复用 harness。）

- [ ] **Step 2: 跑测试确认失败** → **Step 3: 实现**

dry-event.ts：body 含 `plugin` 时经 `deps.getPluginEventEntry(plugin)` 取 entry → `applyEventMappings(event, entry, isCanonical, onUnknown)` → 空数组 → `mapping: { matched: false, dropped: true }` 直接返回（后续跳无输入）；非空 → 对 `out[0]` 走现有 normalize/matrix/field-contract 链，响应加 `mapping: { matched, to }`。facets 输出对象加 `approval: f.approval`。

index.ts：dry-event 路由注册处 deps 加 `getPluginEventEntry: (name) => { const e = this.runtimeLoader?.get(name); return e?.eventMappings ? { eventSource: e.eventSource, eventMappings: e.eventMappings, transformEvent: e.transformEvent } : null; }`

- [ ] **Step 4: 测试 + build** → **Step 5: Commit**

```bash
git add gateway/src/routes/dry-event.ts gateway/src/index.ts gateway/tests/unit/routes/dry-event.test.ts
git commit -m "feat(runtime): dry-event supports plugin native events (mapping hop) + approval facet echo"
```

---

### Task 8: 暗契约补登（permission_mode / session.diff 入册）

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts`（union 增补）
- Modify: `gateway/src/runtime/event-flow-matrix.ts`（补两行）
- Test: 现有交叉校验测试自动覆盖（`event-flow-matrix.test.ts`）

- [ ] **Step 1: 先读确认现状**

读 `gateway/src/index.ts` 约 2212 行 `permission_mode` 广播调用，确认信封形状（扁平顶层 or `opencode_event` 信封）。读 `packages/gateway-sdk/src/events.ts` 的 RUNTIME_EVENT_TYPES 与 FLAT_EVENT_TYPES。

- [ ] **Step 2: 入册**

- `permission_mode`：gateway 自产自销——若为扁平广播 → `FLAT_EVENT_TYPES` 增补 + 矩阵行 `{ modeA: 'passthrough', desktop: 'handled', tui: 'handled', note: 'gateway 自发：审批三档预设变更' }`
- `session.diff`：opencode v2 原生 SSE passthrough → `RUNTIME_EVENT_TYPES` 增补 + 矩阵行 `{ modeA: 'passthrough', desktop: 'handled', tui: 'ignore', note: 'opencode v2 会话 diff（diffApi 能力）' }`

- [ ] **Step 3: 跑交叉校验 + SDK 测试**

Run: `cd gateway; npx jest tests/unit/runtime/event-flow-matrix.test.ts --runInBand`
Expected: PASS（若有 SDK 侧断言数量快照的测试同步更新——只许更新计数/清单常量）

- [ ] **Step 4: Commit**

```bash
git add packages/gateway-sdk/src/events.ts gateway/src/runtime/event-flow-matrix.ts
git commit -m "fix(runtime): register permission_mode + session.diff into event vocabulary (dark contract holes)"
```

---

### Task 9: 文档 + 发版 4.20.0 + 部署

**Files:**
- Modify: `AGENTS.md`（§5.19 区域补事件注册段）
- Modify: `gateway/src/runtime/loader.ts` 的 `README_CONTENT`
- Modify: `package.json` 等版本（bump 脚本）

- [ ] **Step 1: AGENTS.md 补段**（插在 Runtime 能力契约 §5.19 事件相关段落之后）

```markdown
#### 事件映射注册（2026-10-08，v4.20.0）

runtime 插件经纯数据表把原生事件接入 canonical 管线，不再手写翻译层：
- 插件声明：`module.exports.eventSource { typePath, sessionIdPath?, directoryPath? }` +
  `eventMappings: [{ from, to, when?, fields? }]`（`to: 'drop'` 显式丢弃；fields 值 =
  `{path,default?}|{const}|{template}`；路径 = 裁剪 JSONPath 子集无 eval）+
  `transformEvent(raw)` 逃逸口（状态机/扇出/副作用；未匹配才调用）
- 匹配优先级：eventMappings（数组序）→ canonical 直发 passthrough → transformEvent → 丢弃+遥测
- gateway 侧：`CANONICAL_FACET_RULES`（canonical-facets.ts）把 canonical type → EventFacets
  表化（原 normalizeOpencodeEvent if 链；oracle 测试钉扎等价）；toolCommand（type includes
  'tool' + 信封依赖）与 approval metadata 构造为执行器内置特例
- 加载期校验：未知 canonical to / 坏路径 → 插件 eventStream 能力降级 + error 状态（fail-open）
- dry-event 试衣间：`POST /api/runtime/dry-event { plugin, event }` 输出映射→facet→矩阵每跳
- pi 已迁入（turn_end 写 part.messageID 修复 step facet 对齐）；opencode 原生事件即 canonical
  不包装。词汇表沿用 opencode 形状（25+13 类型，含 permission_mode/session.diff）
```

- [ ] **Step 2: loader README_CONTENT 补插件声明示例**（eventSource/eventMappings/transformEvent 段，内容同 AGENTS.md 要点 + 一个完整映射示例）

- [ ] **Step 3: bump + 全量 + build**

```bash
node scripts/bump-version.mjs 4.20.0; node scripts/bump-version.mjs --check
cd gateway; npx jest --runInBand
npm run build
```
Expected: 全绿（预计 237+ suites / 1590+ tests）；build exit 0

- [ ] **Step 4: 部署**

```bash
npm pack
mafw stop
npm install -g jack200714-mafw-4.20.0.tgz
mafw daemon
# 轮询 http://127.0.0.1:3000/health 直到 ok（~45-60s；"Gateway already running"=stale PID，重做 stop/daemon）
# 检查 /api/runtime：active=opencode、pi status ok
```

- [ ] **Step 5: Commit + 交付记忆**

```bash
git add AGENTS.md gateway/src/runtime/loader.ts package.json packages/*/package.json docs/superpowers/plans/2026-10-08-event-mapping-registration.md
git commit -m "chore: bump version 4.20.0 (declarative event mapping registration)"
```

存交付记忆（commits 清单、测试增量、turn_end bug 修复、pi live 验证仍 deferred）。

---

## Self-Review 记录

- **Spec 覆盖**：§4 PluginEventMap → Task 1/2/5；§5 CanonicalFacetTable → Task 3/4；§6 加载期校验 + dry-event → Task 5/7；§7 迁移四步 → Task 6（pi）/4（opencode dogfood）/8（暗契约）；§7 turn_end 修复 → Task 6 钉扎测试。✅
- **风险项**：pi permission 事件实际输入形状（顶层 type 有无）→ Task 6 Step 3 注明"以测试实际走的路径为准"；pi-runtime 注册路径 → 同注。
- **类型一致性**：`EventMappingEntry` 三任务共用；`registerBuiltin` 第 5 参 Task 5 定义 Task 6 消费；`evaluateFacetRules` 签名 Task 3 定义 Task 4 消费。✅
