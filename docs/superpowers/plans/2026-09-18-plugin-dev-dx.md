# 插件开发协助全家桶（L0~L4）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把插件作者的开发回路从"改→reload→发消息→没反应→翻日志→猜"缩短为"构造期报错 / 边界期告警 / 离线试衣 / 一键端到端验证"，五档全上（文档对齐 + 边界遥测 + 事件试衣间 + ctx 构造助手 + 场景一致性 harness）。

**Architecture:** 已知类型集单一事实源复用 `EVENT_FLOW_MATRIX` keys + `session.next.`/`plugin:` 前缀族（全量启用、零误报）；遥测挂在两条事件入口（`handleOpencodeEvent` runtime 流 + `POST /api/events` 扁平发布）；试衣间与一致性 harness 都是 deps 注入路由（复用 normalize/matrix/field-contract 纯函数）；ctx 助手挂在 loader 的 `RuntimePluginContext`；CLI 薄封装 `mafw plugin-test`。

**Tech Stack:** TypeScript、jest --runInBand（gateway）、Node CJS 插件加载（loader）、bin/mafw.js CLI。

## Global Constraints

- 用户偏好 TDD 先行：每任务先写失败测试；完成时汇报新增测试数与全量通过数。
- 每任务测试全绿后自动 commit（用户已确认此模式）。
- gateway 测试：`cd gateway && npx jest <path> --runInBand`；全量 `npm test`。
- **fail-open 铁律**：遥测/试衣间/助手/harness 任何失败不得阻塞事件流或弄崩 gateway/desktop。
- 路由双登记：`route-catalog.ts` NON_SDK_ROUTES + `wave2-handlers.ts` attachHandler（operationId 一致）。
- 新模块零跨包依赖（event-telemetry/field-contract/scenarios 只 import gateway 内模块）。
- 文档更新用 edit 工具做定点修改，禁止整文件重写（防章节丢失——曾有教训）；改前记录章节清单，改后核对。

## 背景：已锁定的三个决策（2026-09-18 探讨结论）

1. 投入档位：L0~L4 全家（五档）。
2. 遥测范围：**全量启用**（内置 runtime 也采集）——前提是把 `session.next.*` 前缀族收编进已知集，保零误报。
3. 试衣间形态：HTTP 端点 `POST /api/runtime/dry-event`。

---

### Task 1: L1 遥测模块（event-telemetry.ts）

**Files:**
- Create: `gateway/src/runtime/event-telemetry.ts`
- Test: `gateway/tests/unit/runtime/event-telemetry.test.ts`

**Interfaces:**
- Consumes: `EVENT_FLOW_MATRIX`（event-flow-matrix.ts）
- Produces（Task 2/4/5 依赖）:
  - `isKnownEventType(type: string | undefined): boolean`
  - `class UnknownEventTracker { record(source: string, type: string): { firstSeen: boolean; total: number }; snapshot(): Record<string, Record<string, number>>; reset(): void }`

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/runtime/event-telemetry.test.ts`：

```ts
import {
  isKnownEventType,
  UnknownEventTracker,
} from '../../../src/runtime/event-telemetry';

describe('isKnownEventType', () => {
  it('accepts every matrix key', () => {
    // 矩阵 keys 全部已知（间接锁定已知集 ⊇ 矩阵）
    for (const t of ['session.idle', 'message.part.updated', 'project_registered', 'runtime_switched', 'session.next.tool.failed']) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });

  it('accepts prefix families (plugin namespace + legacy session.next.*)', () => {
    expect(isKnownEventType('plugin:myplug:done')).toBe(true);
    expect(isKnownEventType('session.next.tool.updated')).toBe(true);
    expect(isKnownEventType('session.next.followup.started')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isKnownEventType('my_custom_event')).toBe(false);
    expect(isKnownEventType('session.future.thing')).toBe(false);
    expect(isKnownEventType(undefined)).toBe(true); // 无 type 不算未知（畸形另有判定）
    expect(isKnownEventType('')).toBe(true);
  });
});

describe('UnknownEventTracker', () => {
  it('counts per source+type and reports firstSeen once', () => {
    const t = new UnknownEventTracker();
    expect(t.record('my-runtime', 'weird.event')).toEqual({ firstSeen: true, total: 1 });
    expect(t.record('my-runtime', 'weird.event')).toEqual({ firstSeen: false, total: 2 });
    expect(t.record('other', 'weird.event')).toEqual({ firstSeen: true, total: 1 });
    expect(t.snapshot()).toEqual({
      'my-runtime': { 'weird.event': 2 },
      other: { 'weird.event': 1 },
    });
  });

  it('reset clears everything', () => {
    const t = new UnknownEventTracker();
    t.record('s', 'x');
    t.reset();
    expect(t.snapshot()).toEqual({});
  });

  it('caps tracked types per source (bounded memory)', () => {
    const t = new UnknownEventTracker();
    for (let i = 0; i < 150; i++) t.record('s', `t${i}`);
    expect(Object.keys(t.snapshot()['s']).length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/event-telemetry.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement**

`gateway/src/runtime/event-telemetry.ts`：

```ts
/**
 * 事件边界遥测 —— 插件（及内置 runtime）未知事件类型的采集与告警。
 *
 * 已知集 = EVENT_FLOW_MATRIX keys（canonical 全集，测试保证与 SDK union 同步）
 *        ∪ 前缀族（plugin:* 命名空间 / session.next.* legacy 族）。
 * 全量启用（内置 runtime 也采集）依赖该已知集覆盖内置实际发射的全部类型。
 *
 * fail-open：record/查询任何异常不抛出（调用方在事件热路径上）。
 */
import { EVENT_FLOW_MATRIX } from './event-flow-matrix';

const KNOWN_PREFIXES = ['plugin:', 'session.next.'];

/** 矩阵 keys 的运行时拷贝（模块加载时构建一次）。 */
const MATRIX_KEYS: ReadonlySet<string> = new Set(Object.keys(EVENT_FLOW_MATRIX));

export function isKnownEventType(type: string | undefined): boolean {
  if (!type) return true; // 无 type 属于畸形事件范畴（isMalformedEvent 管），不算未知
  if (MATRIX_KEYS.has(type)) return true;
  return KNOWN_PREFIXES.some((p) => type.startsWith(p));
}

const MAX_TYPES_PER_SOURCE = 100;

/** per-source（runtime 名或 'api'）per-type 计数器；firstSeen 供调用方做限频 warn。 */
export class UnknownEventTracker {
  private counts = new Map<string, Map<string, number>>();

  record(source: string, type: string): { firstSeen: boolean; total: number } {
    let byType = this.counts.get(source);
    if (!byType) {
      byType = new Map();
      this.counts.set(source, byType);
    }
    if (!byType.has(type) && byType.size >= MAX_TYPES_PER_SOURCE) {
      return { firstSeen: false, total: 0 }; // 有界内存：超出后新类型静默不记
    }
    const total = (byType.get(type) || 0) + 1;
    byType.set(type, total);
    return { firstSeen: total === 1, total };
  }

  snapshot(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [source, byType] of this.counts) {
      out[source] = Object.fromEntries(byType);
    }
    return out;
  }

  reset(): void {
    this.counts.clear();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/event-telemetry.test.ts --runInBand`
Expected: PASS（8 用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-telemetry.ts gateway/tests/unit/runtime/event-telemetry.test.ts
git commit -m "feat(gateway): unknown event telemetry module (known-set from matrix + prefix families)"
```

---

### Task 2: L1 接线（事件入口采集 + /api/runtime 暴露）

**Files:**
- Modify: `gateway/src/index.ts`（handleOpencodeEvent 采集 + runtimeDeps 暴露 + event tap 预留不在此步）
- Modify: `gateway/src/routes/runtime-switch.ts`（GET 响应增 unknownEvents）
- Modify: `gateway/src/routes/event-publish.ts`（扁平未知类型采集）
- Test: 扩展 `gateway/tests/unit/routes/event-publish.test.ts`；新建 `gateway/tests/unit/routes/runtime-get.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `UnknownEventTracker` / `isKnownEventType`
- Produces:
  - `GET /api/runtime` 响应新增 `unknownEvents: Record<string, Record<string, number>>`（快照；恒有键，空对象也返回）
  - `EventPublishDeps` 增可选 `recordUnknown?: (type: string) => void`
  - `RuntimeSwitchDeps` 增可选 `unknownEvents?: () => Record<string, Record<string, number>>`

- [ ] **Step 1: Write the failing tests**

`gateway/tests/unit/routes/runtime-get.test.ts`（新建；mock req/res 模式参考 event-publish.test.ts）：

```ts
import * as http from 'http';
import { handleRuntimeGet } from '../../../src/routes/runtime-switch';

function fakeRes(): { res: http.ServerResponse; body: string; status: number } {
  const res = {} as unknown as http.ServerResponse;
  const out = { body: '', status: 0 };
  (res as any).writeHead = (s: number) => { out.status = s; return res; };
  (res as any).end = (b: string) => { out.body = b; return res; };
  return { res, ...out } as any;
}

describe('GET /api/runtime (unknownEvents exposure)', () => {
  it('includes unknownEvents snapshot in response', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'my-runtime',
      runtimeCaps: () => ({}),
      envOverride: () => false,
      unknownEvents: () => ({ 'my-runtime': { 'weird.event': 3 } }),
    } as any);
    const parsed = JSON.parse(body);
    expect(parsed.unknownEvents).toEqual({ 'my-runtime': { 'weird.event': 3 } });
  });

  it('returns empty object when tracker absent', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'opencode',
      runtimeCaps: () => ({}),
      envOverride: () => false,
    } as any);
    expect(JSON.parse(body).unknownEvents).toEqual({});
  });
});
```

`gateway/tests/unit/routes/event-publish.test.ts` 追加：

```ts
describe('unknown type telemetry', () => {
  it('records flat non-namespaced unknown types', async () => {
    const recorded: string[] = [];
    // 复用该文件既有的请求构造 helper；若名称不同按现状调整
    await handleEventPublish({ broadcast: () => {}, recordUnknown: (t) => recorded.push(t) }, makeReq({ type: 'my_custom_event' }), fakeRes());
    expect(recorded).toEqual(['my_custom_event']);
  });

  it('does not record plugin:* namespaced types', async () => {
    const recorded: string[] = [];
    await handleEventPublish({ broadcast: () => {}, recordUnknown: (t) => recorded.push(t) }, makeReq({ type: 'plugin:x:y' }), fakeRes());
    expect(recorded).toEqual([]);
  });
});
```

（`makeReq`/`fakeRes` 用该测试文件既有 helper；event-publish.test.ts 已存在，按其现状对齐命名。）

- [ ] **Step 2: Run to verify failure**

Run: `cd gateway && npx jest tests/unit/routes/runtime-get.test.ts tests/unit/routes/event-publish.test.ts --runInBand`
Expected: FAIL（unknownEvents 字段缺失 / recordUnknown 未被调用）

- [ ] **Step 3: Implement**

(a) `runtime-switch.ts` —— `handleRuntimeGet` deps 增可选字段并输出：

```ts
// RuntimeSwitchDeps 增：
/** 未知事件遥测快照（per-source per-type 计数）；缺省空对象。 */
unknownEvents?: () => Record<string, Record<string, number>>;

// handleRuntimeGet 响应体增：
unknownEvents: deps.unknownEvents ? deps.unknownEvents() : {},
```

(b) `event-publish.ts` —— deps 增可选 recordUnknown，扁平分支（非 `opencode_event` 信封）在 broadcast 前采集：

```ts
// EventPublishDeps 增：
/** 未知类型遥测（扁平非 plugin:* 命名空间时调用；fail-open）。 */
recordUnknown?: (type: string) => void;

// 扁平分支（原 deps.broadcast(body) 处）改为：
if (!body.type.startsWith('plugin:')) {
  try { deps.recordUnknown?.(body.type); } catch { /* fail-open */ }
}
deps.broadcast(body);
```

(c) `index.ts` —— 三处：
1. import：`import { UnknownEventTracker, isKnownEventType } from './runtime/event-telemetry';`
2. 成员：`private unknownEventTracker = new UnknownEventTracker();`
3. `handleOpencodeEvent` 在 malformed 检查之后、internal 过滤之前插入：

```ts
    // 未知类型遥测（全量启用）：首次出现时 warn 一次给可定位诊断，
    // 计数经 GET /api/runtime 的 unknownEvents 暴露。fail-open 不阻断。
    if (!isKnownEventType(f.type)) {
      try {
        const { firstSeen } = this.unknownEventTracker.record(this.runtimeName, f.type);
        if (firstSeen) {
          log.warn(
            `[SSE] runtime '${this.runtimeName}' emitted unknown event type '${f.type}' ` +
            `(not canonical, not plugin:* namespaced) — desktop will show it as ` +
            `'miss' in the event inspector; counters: GET /api/runtime .unknownEvents`,
          );
        }
      } catch { /* fail-open */ }
    }
```

4. `runtimeDeps()` 返回对象增：`unknownEvents: () => this.unknownEventTracker.snapshot(),`

(d) index.ts 的 event-publish 挂载点（`handleEventPublish({ broadcast: ... })` 处）增：

```ts
recordUnknown: (type: string) => { this.unknownEventTracker.record('api', type); },
```

- [ ] **Step 4: Run tests + 全量回归**

Run: `cd gateway && npx jest tests/unit/routes/ --runInBand && npm test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/routes/runtime-switch.ts gateway/src/routes/event-publish.ts gateway/tests/unit/routes/
git commit -m "feat(gateway): wire unknown-event telemetry into runtime stream + events API + /api/runtime exposure"
```

---

### Task 3: L2 字段契约模块（event-field-contract.ts）

**Files:**
- Create: `gateway/src/runtime/event-field-contract.ts`
- Test: `gateway/tests/unit/runtime/event-field-contract.test.ts`

**Interfaces:**
- Consumes: `isKnownEventType`（Task 1）
- Produces（Task 4/5 依赖）: `checkEventFields(evt: { type?: string; payload?: any; properties?: any; sessionID?: string }): string[]`（空数组 = 无警告）

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/runtime/event-field-contract.test.ts`：

```ts
import { checkEventFields } from '../../../src/runtime/event-field-contract';

describe('checkEventFields', () => {
  it('known well-formed events produce no warnings', () => {
    expect(checkEventFields({ type: 'session.idle', properties: { sessionID: 's1' } })).toEqual([]);
    expect(checkEventFields({
      type: 'message.part.updated',
      properties: { part: { sessionID: 's1', messageID: 'm1', type: 'text', text: 'hi' } },
    })).toEqual([]);
  });

  it('session.idle without any sessionID warns (breaks step-inject drain)', () => {
    const w = checkEventFields({ type: 'session.idle', properties: {} });
    expect(w.some((x) => x.includes('sessionID'))).toBe(true);
  });

  it('message.part.updated text part without text or delta warns', () => {
    const w = checkEventFields({ type: 'message.part.updated', properties: { part: { sessionID: 's1', type: 'text' } } });
    expect(w.some((x) => x.includes('text'))).toBe(true);
  });

  it('session.created without info.id warns (desktop planner yields none)', () => {
    const w = checkEventFields({ type: 'session.created', properties: {} });
    expect(w.some((x) => x.includes('info'))).toBe(true);
  });

  it('permission.asked without requestId/toolName warns', () => {
    const w = checkEventFields({ type: 'permission.asked', properties: { sessionID: 's1' } });
    expect(w.some((x) => x.includes('requestId'))).toBe(true);
    expect(w.some((x) => x.includes('toolName'))).toBe(true);
  });

  it('unknown type warns with canonical/plugin advice', () => {
    const w = checkEventFields({ type: 'my_custom_event', properties: {} });
    expect(w.some((x) => x.includes('plugin:'))).toBe(true);
  });

  it('shape-B flat envelope (payload nesting) is honored', () => {
    const w = checkEventFields({ payload: { type: 'session.idle', properties: {} } });
    expect(w.some((x) => x.includes('sessionID'))).toBe(true);
  });

  it('missing type warns (malformed)', () => {
    expect(checkEventFields({ properties: {} }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/event-field-contract.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement**

`gateway/src/runtime/event-field-contract.ts`：

```ts
/**
 * 事件字段契约 —— skill 文档 3.1 契约表的可执行版。
 *
 * 只做"缺字段会静默失效"的检查（消费方判 none / 无 step / 无 delta），
 * 不做类型白名单校验（那是 isKnownEventType 的职责）。返回 warnings 数组，
 * 空数组 = 无警告；供试衣间端点与 ctx.events.check 共用。
 */
import { isKnownEventType } from './event-telemetry';

type RawEvt = { type?: string; payload?: any; properties?: any; sessionID?: string };

const sidOf = (e: RawEvt): string | undefined =>
  e.properties?.sessionID || e.properties?.part?.sessionID || e.properties?.info?.sessionID ||
  e.payload?.properties?.sessionID || e.payload?.sessionID || e.sessionID;

export function checkEventFields(evt: RawEvt | null | undefined): string[] {
  if (!evt || typeof evt !== 'object') return ['event must be a non-empty object'];
  const type: string = evt.payload?.type || evt.type || '';
  const props: any = evt.payload?.properties || evt.properties || {};
  if (!type) return ["missing 'type' — events without type are dropped as malformed"];
  const warnings: string[] = [];

  if (!isKnownEventType(type)) {
    warnings.push(
      `unknown type '${type}' — desktop renders nothing for it; map to a canonical type ` +
      `(see @mafw/sdk RUNTIME_EVENT_TYPES) or use the 'plugin:<name>:<event>' namespace`,
    );
  }

  const sid = sidOf(evt);
  switch (type) {
    case 'session.idle':
    case 'session.error':
    case 'session.compacting':
    case 'session.compacted':
      if (!sid) warnings.push(`'${type}' without sessionID — step-inject drain / compaction flush will not trigger`);
      break;
    case 'message.part.updated': {
      const part = props?.part;
      if (!part || typeof part !== 'object') {
        warnings.push("message.part.updated without properties.part — no step/delta extraction, desktop shows nothing");
        break;
      }
      if (!sid) warnings.push('message.part.updated without sessionID (part.sessionID or properties.sessionID)');
      if (part.type === 'text' && !part.text && !props?.delta) {
        warnings.push("text part without part.text or properties.delta — streaming render shows nothing");
      }
      break;
    }
    case 'message.updated': {
      const info = props?.info;
      if (!info) {
        warnings.push('message.updated without properties.info — no message skeleton on desktop, no step settlement');
      } else if (info.role === 'assistant' && (!info.id || !info.role)) {
        warnings.push('assistant message.updated without info.id — desktop cannot dedupe message skeleton');
      }
      break;
    }
    case 'session.created':
    case 'session.updated': {
      const info = props?.info;
      if (!info || !info.id) {
        warnings.push(`'${type}' without properties.info.id — desktop Rail planner yields 'none' (list will not sync)`);
      } else if (!info.title) {
        warnings.push(`'${type}' without info.title — desktop tab title stays stale`);
      }
      break;
    }
    case 'session.deleted':
      if (!sid) warnings.push('session.deleted without sessionID — desktop cannot remove it from the list');
      break;
    case 'permission.asked':
    case 'question.asked':
      if (!props?.requestId && !props?.id) warnings.push(`'${type}' without requestId — desktop cannot correlate the flow card`);
      if (type === 'permission.asked' && !props?.toolName && !props?.permission?.tool) {
        warnings.push('permission.asked without toolName — approval card shows generic label');
      }
      if (!sid) warnings.push(`'${type}' without sessionID — card cannot be attached to a session`);
      break;
    default:
      break;
  }
  return warnings;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/event-field-contract.test.ts --runInBand`
Expected: PASS（8 用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-field-contract.ts gateway/tests/unit/runtime/event-field-contract.test.ts
git commit -m "feat(gateway): executable event field contract (skill 3.1 table as code)"
```

---

### Task 4: L2 事件试衣间路由（POST /api/runtime/dry-event）

**Files:**
- Create: `gateway/src/routes/dry-event.ts`
- Modify: `gateway/src/routes/route-catalog.ts`（NON_SDK_ROUTES 登记）
- Modify: `gateway/src/routes/wave2-handlers.ts`（attachHandler）
- Test: `gateway/tests/unit/routes/dry-event.test.ts`

**Interfaces:**
- Consumes: `normalizeOpencodeEvent`（normalize.ts）、`EVENT_FLOW_MATRIX`、`isKnownEventType`、`checkEventFields`
- Produces: `handleDryEvent(req, res): Promise<void>`（零 deps——全部纯函数）

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/routes/dry-event.test.ts`：

```ts
import * as http from 'http';
import { handleDryEvent } from '../../../src/routes/dry-event';

async function post(body: unknown): Promise<{ status: number; json: any }> {
  const req = {
    on: (_ev: string, cb: (d?: string) => void) => {
      if (_ev === 'data') setTimeout(() => cb(JSON.stringify(body)), 0);
      if (_ev === 'end') setTimeout(() => cb(), 5);
      return req;
    },
  } as unknown as http.IncomingMessage;
  let status = 0;
  let payload = '';
  const res = {
    writeHead: (s: number) => { status = s; return res; },
    end: (b: string) => { payload = b; return res; },
  } as unknown as http.ServerResponse;
  await handleDryEvent(req, res);
  return { status, json: JSON.parse(payload) };
}

describe('POST /api/runtime/dry-event', () => {
  it('reports facets + matrix flow for a well-formed session.idle', async () => {
    const { status, json } = await post({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    expect(status).toBe(200);
    expect(json.known).toBe(true);
    expect(json.facets.broadcast).toBe('idle');
    expect(json.facets.chatSignal).toBe('complete');
    expect(json.flow.modeA).toBe('rewrite');
    expect(json.flow.desktop).toBe('handled');
    expect(json.warnings).toEqual([]);
  });

  it('warns on unknown type with plugin advice', async () => {
    const { json } = await post({ event: { type: 'my_custom_event', properties: {} } });
    expect(json.known).toBe(false);
    expect(json.warnings.some((w: string) => w.includes('plugin:'))).toBe(true);
    expect(json.flow).toBeUndefined();
  });

  it('warns on missing fields (session.idle without sessionID)', async () => {
    const { json } = await post({ event: { type: 'session.idle', properties: {} } });
    expect(json.warnings.some((w: string) => w.includes('sessionID'))).toBe(true);
  });

  it('accepts the event object directly at top level (no envelope)', async () => {
    const { json } = await post({ type: 'session.idle', properties: { sessionID: 's1' } });
    expect(json.facets.broadcast).toBe('idle');
  });

  it('rejects non-object body with 400', async () => {
    const { status } = await post('nope');
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && npx jest tests/unit/routes/dry-event.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement**

`gateway/src/routes/dry-event.ts`：

```ts
/**
 * POST /api/runtime/dry-event —— 事件试衣间（插件作者离线验证）。
 *
 * 输入一个 runtime 原生事件样本（形状 A/B 均可，直接对象或 {event} 信封），
 * 返回它将被如何消费：normalize facets + 矩阵每跳处置 + 字段契约警告。
 * 纯函数组装，零 deps，无副作用（不广播、不落库）。
 */
import * as http from 'http';
import { normalizeOpencodeEvent } from '../runtime/normalize';
import { EVENT_FLOW_MATRIX } from '../runtime/event-flow-matrix';
import { isKnownEventType } from '../runtime/event-telemetry';
import { checkEventFields } from '../runtime/event-field-contract';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleDryEvent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    send(400, { error: `invalid JSON body: ${err.message}` });
    return;
  }
  // 宽容输入：{event: {...}} 信封 或 直接对象
  const evt = body && typeof body === 'object' && body.event && typeof body.event === 'object'
    ? body.event
    : body;
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) {
    send(400, { error: 'body must be { event: {...} } or an event object' });
    return;
  }

  const type: string = evt?.payload?.type || evt?.type || '';
  const known = isKnownEventType(type);
  const f = normalizeOpencodeEvent(evt);
  const row = known ? EVENT_FLOW_MATRIX[type] : undefined;
  send(200, {
    type,
    known,
    facets: {
      sessionID: f.sessionID ?? null,
      step: !!f.step,
      chatSignal: f.chatSignal,
      broadcast: f.broadcast,
      compaction: f.compaction,
      toolCommand: f.toolCommand ?? null,
    },
    flow: row ? { modeA: row.modeA, desktop: row.desktop, tui: row.tui, note: row.note } : undefined,
    warnings: checkEventFields(evt),
  });
}
```

`route-catalog.ts` NON_SDK_ROUTES 增一行（P5 Wave 2 补遗块内）：

```ts
  { method: 'POST', path: '/api/runtime/dry-event', operationId: 'runtime.dryEvent', tags: ['internal'] },
```

`wave2-handlers.ts` 增 import 与 attach：

```ts
import { handleDryEvent } from './dry-event';
// attachWave2Handlers 内：
  registry.attachHandler('runtime.dryEvent', H(async (req, res) => handleDryEvent(req, res)));
```

- [ ] **Step 4: Run tests + 全量回归**

Run: `cd gateway && npx jest tests/unit/routes/dry-event.test.ts --runInBand && npm test`
Expected: 全 PASS（含路由注册无重复冲突）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/dry-event.ts gateway/src/routes/route-catalog.ts gateway/src/routes/wave2-handlers.ts gateway/tests/unit/routes/dry-event.test.ts
git commit -m "feat(gateway): event dry-run endpoint POST /api/runtime/dry-event"
```

---

### Task 5: L3 ctx.events 构造期助手

**Files:**
- Modify: `gateway/src/runtime/loader.ts`（RuntimePluginContext + createRuntimePluginContext）
- Test: 新建 `gateway/tests/unit/runtime/ctx-events.test.ts`

**Interfaces:**
- Consumes: `isKnownEventType` / `checkEventFields`（Task 1/3）
- Produces:
  - `RuntimePluginContext.events: { make(type: string, props?: Record<string, any>, sessionID?: string): RawRuntimeEvent; check(evt: object): string[] }`
  - `make` 构造形状 A 信封 `{ payload: { type, properties: { ...props, sessionID? } } }`；未知 type 打 warn（带插件上下文提示）但仍返回事件（fail-open）

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/runtime/ctx-events.test.ts`：

```ts
import { createRuntimePluginContext } from '../../../src/runtime/loader';

describe('ctx.events', () => {
  it('make() constructs shape-A envelope with sessionID merged into properties', () => {
    const ctx = createRuntimePluginContext();
    const evt = ctx.events.make('session.idle', { extra: 1 }, 's1');
    expect(evt).toEqual({
      payload: { type: 'session.idle', properties: { extra: 1, sessionID: 's1' } },
    });
  });

  it('make() omits sessionID key when absent (key stability)', () => {
    const evt = createRuntimePluginContext().events.make('project_registered' as any, { projectDir: '/p' });
    expect('sessionID' in (evt as any).payload.properties).toBe(false);
  });

  it('make() still returns the event on unknown type (fail-open) — warn is log-only', () => {
    const evt = createRuntimePluginContext().events.make('my_custom_event');
    expect((evt as any).payload.type).toBe('my_custom_event');
  });

  it('check() delegates to field contract', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.events.check({ type: 'session.idle', properties: { sessionID: 's1' } })).toEqual([]);
    expect(ctx.events.check({ type: 'session.idle', properties: {} }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/ctx-events.test.ts --runInBand`
Expected: FAIL（ctx.events 不存在）

- [ ] **Step 3: Implement**

`loader.ts`：

```ts
// RuntimePluginContext 增：
  /** 事件构造与校验助手（L3 构造期防线，详见 skill「事件构造助手」节）。 */
  events: {
    /** 构造形状 A 信封；未知 type 打 warn（构造点第一秒可见）但不阻断。 */
    make(type: string, props?: Record<string, any>, sessionID?: string): { payload: { type: string; properties: Record<string, any> } };
    /** 字段契约检查（同 dry-event 端点的 warnings）。 */
    check(evt: object): string[];
  };

// 顶部 import 增：
import { isKnownEventType } from './event-telemetry';
import { checkEventFields } from './event-field-contract';

// createRuntimePluginContext 返回对象增：
    events: {
      make: (type: string, props?: Record<string, any>, sessionID?: string) => {
        if (!isKnownEventType(type)) {
          log.warn(
            `[ctx.events] plugin constructing UNKNOWN event type '${type}' — desktop renders nothing; ` +
            `map to a canonical type or use 'plugin:<name>:<event>' (this warn fires at the emit call site)`,
          );
        }
        return {
          payload: {
            type,
            properties: sessionID ? { ...(props || {}), sessionID } : { ...(props || {}) },
          },
        };
      },
      check: (evt: object) => checkEventFields(evt as any),
    },
```

- [ ] **Step 4: Run tests + 全量回归**

Run: `cd gateway && npx jest tests/unit/runtime/ctx-events.test.ts --runInBand && npm test`
Expected: 全 PASS（loader 既有测试不受影响——ctx 只增字段）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit/runtime/ctx-events.test.ts
git commit -m "feat(gateway): ctx.events builder helper for runtime plugins (construct-time guard)"
```

---

### Task 6: L4 场景一致性 harness（conformance）

**Files:**
- Create: `gateway/src/runtime/conformance-scenarios.ts`（纯场景定义 + 评估器）
- Create: `gateway/src/routes/conformance.ts`（deps 注入路由）
- Modify: `gateway/src/index.ts`（event tap + conformanceDeps + 挂载）
- Modify: `gateway/src/routes/route-catalog.ts`、`wave2-handlers.ts`
- Modify: `bin/mafw.js`（`plugin-test` 子命令）
- Test: `gateway/tests/unit/runtime/conformance-scenarios.test.ts`、`gateway/tests/unit/routes/conformance.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime.session`（create/promptAsync/delete/list）、event tap（本任务新增）
- Produces:
  - `SCENARIOS: ScenarioDef[]`（S1 chat-roundtrip 事件序 + S2 session-lifecycle API 往返）
  - `evaluateScenario(id: string, events: { type: string; sessionID?: string; at: number }[], apiResult?: { created: boolean; deleted: boolean }): { pass: boolean; failures: string[] }`
  - `ConformanceDeps { runtimeName(): string; caps(): any; createSession(opts): Promise<{ id: string }>; promptAsync(opts): Promise<void>; deleteSession(id): Promise<void>; listSessions(): Promise<any[]>; registerEventTap(sessionID, cb): () => void }`
  - `POST /api/runtime/conformance` → `{ results: [{ id, title, pass, failures, durationMs }], summary: { pass, fail } }`
  - index.ts: `registerEventTap(sessionID: string, cb: (e: { type: string; sessionID?: string; at: number }) => void): () => void`

- [ ] **Step 1: Write the failing tests**

`gateway/tests/unit/runtime/conformance-scenarios.test.ts`：

```ts
import { SCENARIOS, evaluateScenario } from '../../../src/runtime/conformance-scenarios';

const ev = (type: string, at = 0) => ({ type, at });

describe('S1 chat-roundtrip evaluator', () => {
  it('passes on delta + terminal sequence', () => {
    const events = [ev('message.part.updated', 1), ev('message.part.delta', 2), ev('message.complete', 3)];
    expect(evaluateScenario('chat-roundtrip', events)).toEqual({ pass: true, failures: [] });
  });

  it('fails when no content event ever arrives (silent runtime)', () => {
    const events = [ev('session.idle', 1)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('content'))).toBe(true);
  });

  it('fails when no terminal event (turn never settles)', () => {
    const events = [ev('message.part.updated', 1), ev('message.part.delta', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('terminal'))).toBe(true);
  });

  it('fails on error terminal (counts as failure with error note)', () => {
    const events = [ev('message.part.updated', 1), ev('message.error', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
  });
});

describe('S2 session-lifecycle evaluator', () => {
  it('passes when created and deleted both observed via API', () => {
    expect(evaluateScenario('session-lifecycle', [], { created: true, deleted: true })).toEqual({ pass: true, failures: [] });
  });
  it('fails when created missing', () => {
    const r = evaluateScenario('session-lifecycle', [], { created: false, deleted: true });
    expect(r.pass).toBe(false);
  });
  it('fails when deleted missing (session leaked)', () => {
    const r = evaluateScenario('session-lifecycle', [], { created: true, deleted: false });
    expect(r.pass).toBe(false);
  });
});

describe('catalog', () => {
  it('has 2 scenarios with prompts and timeouts', () => {
    expect(SCENARIOS.length).toBe(2);
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.timeoutMs).toBeGreaterThan(1000);
    }
  });
});
```

`gateway/tests/unit/routes/conformance.test.ts`：

```ts
import * as http from 'http';
import { handleConformance } from '../../../src/routes/conformance';

function fakeRes() {
  let payload = '';
  const res: any = { writeHead: () => res, end: (b: string) => { payload = b; return res; } };
  return { res, body: () => JSON.parse(payload) };
}

function makeDeps(overrides: Partial<import('../../../src/routes/conformance').ConformanceDeps> = {}) {
  const sessions = new Map<string, boolean>();
  return {
    runtimeName: () => 'fake-runtime',
    caps: () => ({ sessionApi: true, eventStream: true }),
    createSession: async () => { const id = 't1'; sessions.set(id, true); return { id }; },
    promptAsync: async () => {},
    deleteSession: async (id: string) => { sessions.delete(id); },
    listSessions: async () => [...sessions.keys()].map((id) => ({ id })),
    registerEventTap: (_sid: string, cb: (e: any) => void) => {
      // 立即回放一条成功序列，模拟 runtime 事件
      setTimeout(() => { cb({ type: 'message.part.updated', sessionID: 't1', at: 1 }); cb({ type: 'message.complete', sessionID: 't1', at: 2 }); }, 5);
      return () => {};
    },
    ...overrides,
  } as import('../../../src/routes/conformance').ConformanceDeps;
}

async function post(body: unknown, deps: any) {
  const req: any = {
    on: (ev: string, cb: (d?: string) => void) => {
      if (ev === 'data') setTimeout(() => cb(JSON.stringify(body)), 0);
      if (ev === 'end') setTimeout(() => cb(), 5);
      return req;
    },
  };
  const { res, body: json } = fakeRes();
  await handleConformance(req, res, deps);
  return json();
}

describe('POST /api/runtime/conformance', () => {
  it('runs all scenarios and reports pass summary', async () => {
    const json = await post({}, makeDeps());
    expect(json.summary).toEqual({ pass: 2, fail: 0 });
    expect(json.results.every((r: any) => r.pass)).toBe(true);
  });

  it('reports failure when tap sees nothing (timeout fast path)', async () => {
    const deps = makeDeps({ registerEventTap: () => () => {} });
    const json = await post({ timeoutMs: 200 }, deps);
    expect(json.summary.fail).toBe(1);
  });

  it('skips gracefully with 503 when sessionApi missing', async () => {
    const deps = makeDeps({ caps: () => ({}) });
    const json = await post({}, deps);
    expect(json.summary).toBeDefined(); // 全场景按能力降级标记 fail/skip 而非崩
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gateway && npx jest tests/unit/runtime/conformance-scenarios.test.ts tests/unit/routes/conformance.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement**

(a) `gateway/src/runtime/conformance-scenarios.ts`：

```ts
/**
 * 场景一致性（conformance）—— runtime 插件接入的可执行验证。
 *
 * 场景评估器是纯函数（事件序列 / API 观测 → pass/fail），
 * jest 可离线测；路由层只负责驱动真实 runtime 并收集观测。
 */
export interface ObservedEvent {
  type: string;
  sessionID?: string;
  at: number;
}

export interface ScenarioDef {
  id: 'chat-roundtrip' | 'session-lifecycle';
  title: string;
  description: string;
  prompt: string;
  /** 单场景最长等待（含 LLM 往返） */
  timeoutMs: number;
  /** 该场景需要的能力（缺失 → 场景标 fail + 说明，而非崩） */
  requires: { eventStream?: boolean };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'chat-roundtrip',
    title: '对话回合（事件序）',
    description: 'promptAsync 后应观察到内容事件（part/delta/updated）且回合有终态（complete/idle/error）',
    prompt: 'Reply with the single word: OK',
    timeoutMs: 90_000,
    requires: { eventStream: true },
  },
  {
    id: 'session-lifecycle',
    title: '会话生命周期（API）',
    description: 'create → list 可见 → delete → list 不可见',
    prompt: '',
    timeoutMs: 15_000,
    requires: {},
  },
];

const CONTENT_TYPES = new Set(['message.part.updated', 'message.part.delta', 'message.updated']);
const TERMINAL_TYPES = new Set(['message.complete', 'session.idle', 'message.error', 'session.error']);

export function evaluateScenario(
  id: string,
  events: ObservedEvent[],
  apiResult?: { created: boolean; deleted: boolean },
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (id === 'chat-roundtrip') {
    const content = events.filter((e) => CONTENT_TYPES.has(e.type));
    const terminal = events.filter((e) => TERMINAL_TYPES.has(e.type));
    if (content.length === 0) failures.push('no content event observed (message.part.updated/delta/message.updated) — streaming render impossible');
    if (terminal.length === 0) failures.push('no terminal event observed (message.complete/session.idle) — turn never settles, UI stays busy');
    const errored = events.some((e) => e.type === 'message.error' || e.type === 'session.error');
    if (errored) failures.push('turn ended in error state');
  } else if (id === 'session-lifecycle') {
    if (!apiResult?.created) failures.push('created session not visible in session.list');
    if (!apiResult?.deleted) failures.push('deleted session still visible in session.list (leak)');
  } else {
    failures.push(`unknown scenario '${id}'`);
  }
  return { pass: failures.length === 0, failures };
}
```

(b) `gateway/src/routes/conformance.ts`：

```ts
/**
 * POST /api/runtime/conformance —— 对活跃 runtime 跑场景一致性验证。
 *
 * 驱动真实会话（消耗 LLM 调用），事件观测经 gateway 的 event tap 收集；
 * 结果含 per-scenario pass/fail 与失败说明。会话尽力清理（fail-open）。
 */
import * as http from 'http';
import { SCENARIOS, evaluateScenario, ObservedEvent } from '../runtime/conformance-scenarios';

export interface ConformanceDeps {
  runtimeName(): string;
  caps(): { sessionApi?: boolean; eventStream?: boolean } & Record<string, unknown>;
  createSession(opts?: { directory?: string }): Promise<{ id: string }>;
  promptAsync(opts: { sessionID: string; message: string }): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listSessions(): Promise<Array<{ id?: string }>>;
  registerEventTap(sessionID: string, cb: (e: ObservedEvent) => void): () => void;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等 tap 攒出终态事件或超时；返回该窗口内全部观测。 */
async function collectUntilTerminal(
  tapReg: ConformanceDeps['registerEventTap'],
  sid: string,
  timeoutMs: number,
): Promise<ObservedEvent[]> {
  const events: ObservedEvent[] = [];
  let settled = false;
  const stop = tapReg(sid, (e) => {
    events.push(e);
    if (e.type === 'message.complete' || e.type === 'session.idle' || e.type === 'message.error' || e.type === 'session.error') {
      settled = true;
    }
  });
  const deadline = Date.now() + timeoutMs;
  while (!settled && Date.now() < deadline) await sleep(250);
  await sleep(250); // 尾部事件余量
  stop();
  return events;
}

export async function handleConformance(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ConformanceDeps,
): Promise<void> {
  let body: any = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* 缺省全场景 */ }
  const only: string[] | undefined = Array.isArray(body?.scenarios) ? body.scenarios : undefined;
  const perTimeout: number | undefined = typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined;
  const caps = deps.caps() as any;

  const send = (payload: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const results: Array<{ id: string; title: string; pass: boolean; failures: string[]; durationMs: number }> = [];
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.id)) continue;
    const t0 = Date.now();
    if (!caps.sessionApi) {
      results.push({ id: sc.id, title: sc.title, pass: false, failures: ['runtime does not declare sessionApi — scenario skipped as failure'], durationMs: 0 });
      continue;
    }
    if (sc.requires.eventStream && !caps.eventStream) {
      results.push({ id: sc.id, title: sc.title, pass: false, failures: ['runtime does not declare eventStream — scenario requires event observations'], durationMs: 0 });
      continue;
    }
    try {
      if (sc.id === 'chat-roundtrip') {
        const sess = await deps.createSession({});
        const events = await (async () => {
          const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
          await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
          return p;
        })();
        const r = evaluateScenario(sc.id, events);
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else {
        const sess = await deps.createSession({});
        const listAfterCreate = await deps.listSessions();
        const created = listAfterCreate.some((s) => s.id === sess.id);
        await deps.deleteSession(sess.id);
        const listAfterDelete = await deps.listSessions();
        const deleted = !listAfterDelete.some((s) => s.id === sess.id);
        const r = evaluateScenario(sc.id, [], { created, deleted });
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      }
    } catch (err: any) {
      results.push({ id: sc.id, title: sc.title, pass: false, failures: [`scenario crashed: ${err.message}`], durationMs: Date.now() - t0 });
    }
  }
  send({
    runtime: deps.runtimeName(),
    results,
    summary: { pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length },
  });
}
```

(c) `index.ts` —— event tap + deps + 挂载：
1. 成员：`private eventTaps = new Map<string, Set<(e: { type: string; sessionID?: string; at: number }) => void>>();`
2. `handleOpencodeEvent` 在 normalize 之后（malformed 检查后）插入：

```ts
    // Conformance event tap：per-session 临时观察者（POST /api/runtime/conformance 用）
    if (sessionID) {
      const taps = this.eventTaps.get(sessionID);
      if (taps && taps.size) {
        const snap = { type: f.type, sessionID, at: Date.now() };
        for (const t of taps) { try { t(snap); } catch { /* fail-open */ } }
      }
    }
```

（注意放在 `const { type, ... } = f;` 解构之后、internal 过滤之前——tap 要看到全量事件。`sessionID` 变量在解构行取得。）

3. 方法：

```ts
  /** 注册 per-session 事件观察者（conformance harness 用）；返回注销函数。 */
  registerEventTap(sessionID: string, cb: (e: { type: string; sessionID?: string; at: number }) => void): () => void {
    let set = this.eventTaps.get(sessionID);
    if (!set) { set = new Set(); this.eventTaps.set(sessionID, set); }
    set.add(cb);
    return () => { set!.delete(cb); if (set!.size === 0) this.eventTaps.delete(sessionID); };
  }
```

4. deps 方法（runtimeDeps 旁）：

```ts
  /** POST /api/runtime/conformance deps。 */
  private conformanceDeps(): ConformanceDeps {
    return {
      runtimeName: () => this.runtimeName,
      caps: () => this.runtimeCaps as any,
      createSession: async (opts) => this.runtime!.session.create(opts || {}),
      promptAsync: async (opts) => { await this.runtime!.session.promptAsync(opts); },
      deleteSession: async (id) => { await this.runtime!.session.delete({ sessionID: id }); },
      listSessions: async () => {
        const r: any = await this.runtime!.session.list({});
        return Array.isArray(r) ? r : (r?.sessions || r?.data || []);
      },
      registerEventTap: (sid, cb) => this.registerEventTap(sid, cb),
    };
  }
```

5. `route-catalog.ts` NON_SDK_ROUTES 增：`{ method: 'POST', path: '/api/runtime/conformance', operationId: 'runtime.conformance', tags: ['internal'] },`
6. `wave2-handlers.ts` 增 import + attach（deps 经 Wave2Gateway 新成员 `conformanceDeps(): ConformanceDeps` 暴露，接口面同 runtimeDeps 模式）：

```ts
  registry.attachHandler('runtime.conformance', H(async (req, res) =>
    handleConformance(req, res, gw.conformanceDeps())));
```

(d) `bin/mafw.js`：
- COMMANDS 数组加 `'plugin-test'`
- switch 加 case：

```js
    case 'plugin-test': await runConformance(); break;
```

- 函数（callApi 旁；180s 超时覆盖 90s 场景）：

```js
// `mafw plugin-test`: run conformance scenarios against the ACTIVE runtime
// (drives real sessions — costs one LLM roundtrip per scenario).
async function runConformance() {
  const port = process.env.MAFW_SERVER_API_PORT || 3000;
  const res = await fetch(`http://127.0.0.1:${port}/api/runtime/conformance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(180000),
  }).catch((e) => { console.error(`Gateway unreachable: ${e.message}`); process.exit(1); });
  const data = await res.json();
  console.log(`Runtime: ${data.runtime}`);
  for (const r of data.results || []) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${r.id} — ${r.title} (${r.durationMs}ms)`);
    for (const f of r.failures || []) console.log(`         - ${f}`);
  }
  console.log(`Summary: ${data.summary.pass} pass / ${data.summary.fail} fail`);
  process.exit(data.summary.fail > 0 ? 1 : 0);
}
```

- [ ] **Step 4: Run tests + 全量回归**

Run: `cd gateway && npx jest tests/unit/runtime/conformance-scenarios.test.ts tests/unit/routes/conformance.test.ts --runInBand && npm test`
Expected: 全 PASS

- [ ] **Step 5: Dogfood（真跑验证误报边界）**

Run: `mafw health` 确认 gateway 在跑 → `curl -X POST http://127.0.0.1:3000/api/runtime/conformance -H "Content-Type: application/json" -d "{}"`
Expected: 内置 runtime 两场景 PASS；`mafw logs` 无 unknown-type 误报 warn（全量遥测零误报的实弹验证）。gateway 未跑则跳过并在完成报告中注明（留给用户手测）。

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/conformance-scenarios.ts gateway/src/routes/conformance.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts gateway/src/routes/wave2-handlers.ts bin/mafw.js gateway/tests/unit/runtime/conformance-scenarios.test.ts gateway/tests/unit/routes/conformance.test.ts
git commit -m "feat: conformance harness (scenarios + event tap + POST /api/runtime/conformance + mafw plugin-test)"
```

---

### Task 7: L0 文档对齐（skill + AGENTS.md，定点修改）

**Files:**
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`（定点 edit，禁整文件重写）
- Modify: `AGENTS.md`（§5.19 增补一小段）

**Interfaces:** 无代码——文档反映 Task 1-6 的实际 API。

- [ ] **Step 1: 章节基线清单（改前核对，防丢失）**

记录 SKILL.md 现有章节标题清单（概述/第一步~第六步/可选接口详解/常见陷阱/调试技巧/完整示例/架构文档/总结），改后逐项核对无缺失。

- [ ] **Step 2: 定点修改 SKILL.md**

1. **§3.4 表格下方第 3 点**（"其余未知 type 静默忽略——SSE 规范行为"）替换为现状：
   > 其余未知 type 不再完全静默——gateway 入口计数告警（`GET /api/runtime` 的 `unknownEvents`）、desktop 会打 `[mafw] unhandled SSE event` warn 并在事件检查器（Ctrl+Shift+E）里以 `miss` 红显。事件不会被丢弃（fail-open），但"发了没人理"现在是可观测的。
2. **§3.6 自定义事件路径 2** 补充：`plugin:*` 命名空间事件是 tail-accounted 静默放行（合法），非命名空间未知类型触发上述遥测。
3. **§3.7 检查清单** 追加三行：
   - [ ] 事件样本过一遍试衣间：`curl -X POST .../api/runtime/dry-event -d '{"event": {...}}'` → `warnings` 为空
   - [ ] 用 `ctx.events.make()` 构造事件（未知 type 构造点即 warn）
   - [ ] 端到端：`mafw plugin-test`（两场景 PASS）
4. **新增小节「开发工具箱」（调试技巧之后）**：四个工具各一段——unknownEvents 遥测（含义 + 在哪看）、dry-event 试衣间（curl 示例 + 响应字段解读）、ctx.events（make/check 签名）、mafw plugin-test（说明会消耗一次 LLM 往返）。
5. **常见陷阱 #3** 的"解决"段追加一句：用 dry-event 端点替代肉眼对照契约表。

- [ ] **Step 3: AGENTS.md §5.19 增补**（契约段落后）：

```markdown
> **插件开发协助四件套（2026-09-18）**：①未知事件遥测（`event-telemetry.ts`，已知集=矩阵 keys ∪ `plugin:`/`session.next.` 前缀，全量启用，`GET /api/runtime` 暴露 `unknownEvents`）；②事件试衣间 `POST /api/runtime/dry-event`（normalize facets + 矩阵每跳处置 + 字段契约警告，纯函数零 deps）；③`ctx.events.make/check` 构造期助手（loader ctx，未知 type 构造点 warn）；④场景一致性 `POST /api/runtime/conformance` + `mafw plugin-test`（S1 事件序/S2 生命周期，event tap 收集观测，驱动真实会话消耗 LLM 往返）。字段契约可执行版：`event-field-contract.ts`。
```

- [ ] **Step 4: 核对章节清单 + 全量测试确认无破坏**

Run: 章节清单逐项核对；`cd gateway && npm test`
Expected: 章节零丢失；测试全绿（文档不影响，确认无意外改动）

- [ ] **Step 5: Commit**

```bash
git add .opencode/skills/runtime-plugin-authoring/SKILL.md AGENTS.md
git commit -m "docs: plugin dev DX toolkit (telemetry/dry-run/ctx.events/plugin-test) in skill + AGENTS"
```

---

## Self-Review 记录

- **范围覆盖**：L0→Task 7；L1→Task 1+2；L2→Task 3+4；L3→Task 5；L4→Task 6。三个已锁定决策全部落实（全家 / 全量启用含前缀收编 / HTTP 端点）。✓
- **占位符扫描**：Task 2 Step 1 的 event-publish 测试追加注明"按该文件既有 helper 命名对齐"（该文件已存在，执行时读现状）；其余代码完整。
- **类型一致性**：`isKnownEventType`/`checkEventFields`/`ObservedEvent`/`ConformanceDeps` 跨任务签名一致；`registerEventTap` 在 index.ts（实现）与 ConformanceDeps（消费）签名一致。
- **已知风险**：①Task 6 的 event tap 插入位置在 internal 过滤**之前**——memory worker 会话的 token 噪音也会进 tap，但 conformance 只对自建测试会话注册 tap，不受影响；②`session.list` 返回形状在不同 runtime 有差异（数组 vs {sessions}），conformanceDeps 已做三形态归一；③Task 2 在 index.ts 热路径插入遥测——try/catch 全包裹 + Map 操作 O(1)，性能影响可忽略；④全量遥测零误报依赖前缀族收编完整——Task 6 Step 5 的 dogfood 是实弹验证关。
