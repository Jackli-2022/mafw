# 跨 runtime 工具 part 兼容（ToolPartAssembler + MessageNormalizer）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「call/result 分离」模型的 runtime（pi 为首）经 gateway 统一合帧为 opencode 形状 ToolPart，桌面/trajectory/flow-card 零改动渲染工具卡。

**Architecture:** plugin raw → eventMappings（新增三原语 `tool.call`/`tool.delta`/`tool.result` 抽取）→ `ToolPartAssembler`（gateway 拥有，per-session、callID 键控状态机，产 opencode 形状 `message.part.updated` 快照）→ canonical 管线。历史路径经可选 `session.normalizeMessages` 归一 `{info, parts}` DTO。

**Tech Stack:** TypeScript（gateway，CJS）、jest（`cd gateway && npx jest --runInBand`）、既有 `applyEventMappings`/`wrapGlobalEventStream` 机制。

**Spec:** `docs/superpowers/specs/2026-10-12-tool-part-compat-design.md`（已批准）

## Global Constraints

- TDD 先行：每个 Task 先写失败测试再实现。
- 三原语 `tool.call`/`tool.delta`/`tool.result` 是**内部类型**：进 `CANONICAL_TYPE_SET`（加载期校验用）但**不进** `packages/gateway-sdk/src/events.ts`、不进 `EVENT_FLOW_MATRIX`、不得广播出 gateway。
- part.id 确定性：`toolpart_<callID>`（live 与历史同 id，store upsert 去重）。
- assembler 每帧产**全量快照**（opencode `message.part.updated` 语义），不产增量。
- output delta 广播默认关（能力位预留，本期不实现输出增量广播）。
- opencode 内置 runtime 恒等直通：装配包装对所有 runtime 应用，opencode 因从不产三原语而零行为变化。
- 桌面/TUI/session-ui 零改动（本设计的不变量）。
- 测试命令：`cd gateway && npx jest <testPath> --runInBand`；全量 `cd gateway && npm test`；类型检查 `cd gateway && npm run build`。

---

### Task 1: ToolPartAssembler 纯逻辑核心

**Files:**
- Create: `gateway/src/runtime/tool-part-assembler.ts`
- Test: `gateway/tests/unit/runtime/tool-part-assembler.test.ts`

**Interfaces:**
- Consumes: `RawRuntimeEvent`（`gateway/src/runtime/normalize.ts`）。
- Produces:
  - `TOOL_PRIMITIVE_TYPES: ReadonlySet<string>`（`'tool.call' | 'tool.delta' | 'tool.result'`）
  - `ToolCallPrimitive = { sessionID: string; messageID?: string; callID: string; tool: string; input?: Record<string, unknown>; title?: string }`
  - `ToolDeltaPrimitive = { sessionID: string; callID: string; kind: 'input' | 'output'; text: string }`
  - `ToolResultPrimitive = { sessionID: string; callID: string; output?: unknown; isError?: boolean; tool?: string; input?: Record<string, unknown>; title?: string; metadata?: Record<string, unknown> }`
  - `coerceOutput(output: unknown): string`（string 原样；content-block 数组拼 text；对象 JSON.stringify；undefined→''）
  - `class ToolPartAssembler { constructor(opts?: { now?: () => number }); applyCall(p): RawRuntimeEvent[]; applyDelta(p): RawRuntimeEvent[]; applyResult(p): RawRuntimeEvent[]; observeAnchor(evt: RawRuntimeEvent): void; dropSession(sessionID: string): void }`
  - 产出事件形状：`{ payload: { type: 'message.part.updated', properties: { part } }, sessionID }`；锚点合成时前置 `{ payload: { type: 'message.updated', properties: { info } }, sessionID }`。

- [ ] **Step 1: 写失败测试**

```ts
// gateway/tests/unit/runtime/tool-part-assembler.test.ts
import { ToolPartAssembler, coerceOutput, TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';

const NOW = 1_700_000_000_000;
const mk = () => new ToolPartAssembler({ now: () => NOW });

function partOf(evts: any[]) {
  return evts[evts.length - 1]?.payload?.properties?.part;
}

describe('coerceOutput', () => {
  test('string 原样 / undefined 空串', () => {
    expect(coerceOutput('x')).toBe('x');
    expect(coerceOutput(undefined)).toBe('');
  });
  test('content-block 数组拼接 text，忽略非文本块', () => {
    expect(coerceOutput([{ type: 'text', text: 'a' }, { type: 'image', data: '...' }, { type: 'text', text: 'b' }])).toBe('ab');
  });
  test('对象 JSON 化', () => {
    expect(coerceOutput({ ok: 1 })).toBe('{"ok":1}');
  });
});

describe('ToolPartAssembler', () => {
  test('三原语类型集', () => {
    expect([...TOOL_PRIMITIVE_TYPES].sort()).toEqual(['tool.call', 'tool.delta', 'tool.result']);
  });

  test('call 带 input → running 快照，id = toolpart_<callID>', () => {
    const a = mk();
    const evts = a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: { command: 'ls' } });
    const part = partOf(evts);
    expect(part.id).toBe('toolpart_c1');
    expect(part.type).toBe('tool');
    expect(part.tool).toBe('bash');
    expect(part.callID).toBe('c1');
    expect(part.sessionID).toBe('s1');
    expect(part.state.status).toBe('running');
    expect(part.state.input).toEqual({ command: 'ls' });
    expect(part.state.time.start).toBe(NOW);
  });

  test('call 无 input → pending', () => {
    const a = mk();
    const part = partOf(a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash' }));
    expect(part.state.status).toBe('pending');
  });

  test('input delta 累积 raw 并增量 parse', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash' });
    let evts = a.applyDelta({ sessionID: 's1', callID: 'c1', kind: 'input', text: '{"comm' });
    expect(partOf(evts).state.status).toBe('pending'); // 未 parse 成功仍 pending
    evts = a.applyDelta({ sessionID: 's1', callID: 'c1', kind: 'input', text: 'and":"ls"}' });
    const part = partOf(evts);
    expect(part.state.input).toEqual({ command: 'ls' });
    expect(part.state.status).toBe('running'); // parse 成功推进 running
  });

  test('output delta 推进 running 但不产帧（默认关）', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash' });
    const evts = a.applyDelta({ sessionID: 's1', callID: 'c1', kind: 'output', text: 'chunk' });
    expect(evts).toHaveLength(0);
  });

  test('result completed → output/title/time.end', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: { command: 'ls' } });
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'c1', output: 'file.txt' }));
    expect(part.state.status).toBe('completed');
    expect(part.state.output).toBe('file.txt');
    expect(part.state.input).toEqual({ command: 'ls' });
    expect(part.state.time.end).toBe(NOW);
  });

  test('result isError → error 状态', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'c1', output: 'boom', isError: true }));
    expect(part.state.status).toBe('error');
    expect(part.state.error).toBe('boom');
  });

  test('result 无先序 call → 合成终态（tool/input 回填）', () => {
    const a = mk();
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'cx', tool: 'read', input: { filePath: '/a' }, output: 'data' }));
    expect(part.id).toBe('toolpart_cx');
    expect(part.tool).toBe('read');
    expect(part.state.status).toBe('completed');
    expect(part.state.input).toEqual({ filePath: '/a' });
  });

  test('重复 result 后者覆盖（幂等快照语义）', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    a.applyResult({ sessionID: 's1', callID: 'c1', output: 'first' });
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'c1', output: 'second' }));
    expect(part.state.output).toBe('second');
  });

  test('缺 callID → 生成 id，不抛', () => {
    const a = mk();
    const part = partOf(a.applyCall({ sessionID: 's1', callID: '', tool: 'bash' }));
    expect(part.id).toMatch(/^toolpart_/);
  });

  test('无锚点 → 合成 assistant 消息（每 session 只发一次）+ part 挂其下', () => {
    const a = mk();
    const evts = a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    expect(evts[0].payload.type).toBe('message.updated');
    expect(evts[0].payload.properties.info.role).toBe('assistant');
    const partMsgId = partOf(evts).messageID;
    expect(partMsgId).toBe(evts[0].payload.properties.info.id);
    const evts2 = a.applyCall({ sessionID: 's1', callID: 'c2', tool: 'bash', input: {} });
    expect(evts2.every((e) => e.payload.type === 'message.part.updated')).toBe(true);
    expect(partOf(evts2).messageID).toBe(partMsgId);
  });

  test('observeAnchor 从过路事件学真实 messageID 后优先使用', () => {
    const a = mk();
    a.observeAnchor({ payload: { type: 'message.part.updated', properties: { part: { id: 'p9', messageID: 'm9', type: 'text' } } }, sessionID: 's1' } as any);
    const part = partOf(a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} }));
    expect(part.messageID).toBe('m9');
  });

  test('message.updated(assistant) 也供锚点', () => {
    const a = mk();
    a.observeAnchor({ payload: { type: 'message.updated', properties: { info: { id: 'a7', role: 'assistant' } } }, sessionID: 's1' } as any);
    expect(partOf(a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} })).messageID).toBe('a7');
  });

  test('dropSession 清理后锚点/工作区重置', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    a.dropSession('s1');
    const evts = a.applyCall({ sessionID: 's1', callID: 'c2', tool: 'bash', input: {} });
    expect(evts[0].payload.type).toBe('message.updated'); // 锚点被清 → 重新合成
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/tool-part-assembler.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// gateway/src/runtime/tool-part-assembler.ts
/**
 * ToolPartAssembler —— 把「call/result 分离」runtime 的三原语合帧为 opencode 形状
 * ToolPart 快照。spec：docs/superpowers/specs/2026-10-12-tool-part-compat-design.md
 * per-session、callID 键控；每帧产全量快照（message.part.updated 语义）。
 */
import { randomUUID } from 'crypto';
import type { RawRuntimeEvent } from './normalize';

export const TOOL_PRIMITIVE_TYPES: ReadonlySet<string> = new Set(['tool.call', 'tool.delta', 'tool.result']);

export interface ToolCallPrimitive {
  sessionID: string; messageID?: string; callID: string; tool: string;
  input?: Record<string, unknown>; title?: string;
}
export interface ToolDeltaPrimitive {
  sessionID: string; callID: string; kind: 'input' | 'output'; text: string;
}
export interface ToolResultPrimitive {
  sessionID: string; callID: string; output?: unknown; isError?: boolean;
  tool?: string; input?: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>;
}

export function coerceOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('');
  }
  try { return JSON.stringify(output); } catch { return String(output); }
}

interface WorkingPart {
  messageID: string; tool: string; callID: string;
  input: Record<string, unknown>; rawInput: string;
  status: 'pending' | 'running'; startMs: number;
}
interface SessionState {
  lastAssistantMessageID?: string;
  syntheticAnchorID?: string;
  working: Map<string, WorkingPart>;
}

function hasInput(input: Record<string, unknown> | undefined): boolean {
  return !!input && Object.keys(input).length > 0;
}

export class ToolPartAssembler {
  private sessions = new Map<string, SessionState>();
  private now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
  }

  private stateFor(sessionID: string): SessionState {
    let s = this.sessions.get(sessionID);
    if (!s) { s = { working: new Map() }; this.sessions.set(sessionID, s); }
    return s;
  }

  /** 从过路 canonical 事件学习当前 assistant 消息锚点。 */
  observeAnchor(evt: RawRuntimeEvent): void {
    const type = (evt as any)?.payload?.type;
    const props = (evt as any)?.payload?.properties;
    const sid = (evt as any)?.sessionID ?? props?.sessionID ?? props?.part?.sessionID ?? props?.info?.sessionID;
    if (typeof sid !== 'string' || !sid) return;
    const s = this.stateFor(sid);
    if (type === 'message.part.updated') {
      const mid = props?.part?.messageID;
      if (typeof mid === 'string' && mid) s.lastAssistantMessageID = mid;
    } else if (type === 'message.updated') {
      const info = props?.info;
      if (info?.role === 'assistant' && typeof info?.id === 'string' && info.id) s.lastAssistantMessageID = info.id;
    }
  }

  /** 锚点缺失时合成 assistant 消息（每 session 一次），返回前置事件（如有）。 */
  private ensureAnchor(sessionID: string, explicit?: string): { messageID: string; pre: RawRuntimeEvent[] } {
    if (explicit) return { messageID: explicit, pre: [] };
    const s = this.stateFor(sessionID);
    if (s.lastAssistantMessageID) return { messageID: s.lastAssistantMessageID, pre: [] };
    if (!s.syntheticAnchorID) {
      s.syntheticAnchorID = `asst_${sessionID}_synth`;
      const info = { id: s.syntheticAnchorID, role: 'assistant', sessionID, parentID: null, time: { created: this.now() } };
      return { messageID: s.syntheticAnchorID, pre: [{ payload: { type: 'message.updated', properties: { info } }, sessionID } as any] };
    }
    return { messageID: s.syntheticAnchorID, pre: [] };
  }

  private partEvent(sessionID: string, part: any): RawRuntimeEvent {
    return { payload: { type: 'message.part.updated', properties: { part } }, sessionID } as any;
  }

  applyCall(p: ToolCallPrimitive): RawRuntimeEvent[] {
    const callID = p.callID || randomUUID().slice(0, 8);
    const { messageID, pre } = this.ensureAnchor(p.sessionID, p.messageID);
    const s = this.stateFor(p.sessionID);
    const w: WorkingPart = {
      messageID, tool: p.tool, callID,
      input: p.input ?? {}, rawInput: '',
      status: hasInput(p.input) ? 'running' : 'pending', startMs: this.now(),
    };
    s.working.set(callID, w);
    return [...pre, this.partEvent(p.sessionID, {
      id: `toolpart_${callID}`, sessionID: p.sessionID, messageID, type: 'tool', callID, tool: p.tool,
      state: { status: w.status, input: w.input, raw: '', time: { start: w.startMs } },
    })];
  }

  applyDelta(p: ToolDeltaPrimitive): RawRuntimeEvent[] {
    const s = this.stateFor(p.sessionID);
    const w = p.callID ? s.working.get(p.callID) : undefined;
    if (!w) return [];
    if (p.kind === 'input') {
      w.rawInput += p.text;
      try {
        const parsed = JSON.parse(w.rawInput);
        if (parsed && typeof parsed === 'object') { w.input = parsed; w.status = 'running'; }
      } catch { /* 增量未完成 */ }
      return [this.partEvent(p.sessionID, {
        id: `toolpart_${w.callID}`, sessionID: p.sessionID, messageID: w.messageID, type: 'tool', callID: w.callID, tool: w.tool,
        state: { status: w.status, input: w.input, raw: w.rawInput, time: { start: w.startMs } },
      })];
    }
    // output delta：只推进状态，默认不广播增量（能力位预留）
    w.status = 'running';
    return [];
  }

  applyResult(p: ToolResultPrimitive): RawRuntimeEvent[] {
    const s = this.stateFor(p.sessionID);
    const callID = p.callID || randomUUID().slice(0, 8);
    let w = s.working.get(callID);
    let pre: RawRuntimeEvent[] = [];
    if (!w) {
      const anchor = this.ensureAnchor(p.sessionID);
      pre = anchor.pre;
      w = {
        messageID: anchor.messageID, tool: p.tool ?? 'unknown', callID,
        input: p.input ?? {}, rawInput: '', status: 'running', startMs: this.now(),
      };
      s.working.set(callID, w);
    }
    const endMs = this.now();
    const output = coerceOutput(p.output);
    const state = p.isError
      ? { status: 'error', input: w.input, error: output, time: { start: w.startMs, end: endMs } }
      : { status: 'completed', input: w.input, output, title: p.title ?? w.tool, metadata: p.metadata ?? {}, time: { start: w.startMs, end: endMs } };
    return [...pre, this.partEvent(p.sessionID, {
      id: `toolpart_${callID}`, sessionID: p.sessionID, messageID: w.messageID, type: 'tool', callID, tool: w.tool, state,
    })];
  }

  dropSession(sessionID: string): void {
    this.sessions.delete(sessionID);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/runtime/tool-part-assembler.test.ts --runInBand`
Expected: PASS（15 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/tool-part-assembler.ts gateway/tests/unit/runtime/tool-part-assembler.test.ts
git commit -m "feat(gateway): ToolPartAssembler — call/result 分离 runtime 的 ToolPart 合帧状态机"
```

---

### Task 2: 事件流接线（wrapToolPartAssembly + 白名单 + createRuntime 两分支）

**Files:**
- Modify: `gateway/src/runtime/tool-part-assembler.ts`（追加 wrapper）
- Modify: `gateway/src/index.ts`（CANONICAL_TYPE_SET 并集 + createRuntime 两处 + handleOpencodeEvent 防漏底线）
- Test: `gateway/tests/unit/runtime/tool-part-assembler-stream.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ToolPartAssembler`/`TOOL_PRIMITIVE_TYPES`；`wrapGlobalEventStream`（`gateway/src/runtime/event-mapper.ts:114`）。
- Produces: `wrapToolPartAssembly(rt: any): void`——包装 `rt.global.event()`，三原语进 assembler、其余透传并喂 observeAnchor。

- [ ] **Step 1: 写失败测试**

```ts
// gateway/tests/unit/runtime/tool-part-assembler-stream.test.ts
import { wrapToolPartAssembly } from '../../../src/runtime/tool-part-assembler';

async function* streamOf(events: any[]) { for (const e of events) yield e; }
function fakeRuntime(events: any[]) {
  return { global: { event: async () => ({ stream: streamOf(events) }) } };
}
async function collect(stream: AsyncIterable<any>) {
  const out: any[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('wrapToolPartAssembly', () => {
  test('非原语事件原样透传（opencode 恒等 oracle）', async () => {
    const events = [
      { payload: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hi' } } }, sessionID: 's1' },
      { payload: { type: 'session.idle', properties: { sessionID: 's1' } }, sessionID: 's1' },
    ];
    const rt = fakeRuntime(events);
    wrapToolPartAssembly(rt);
    const result = await rt.global.event();
    expect(await collect(result.stream)).toEqual(events);
  });

  test('tool.call → message.part.updated ToolPart 快照', async () => {
    const rt = fakeRuntime([
      { payload: { type: 'tool.call', properties: { sessionID: 's1', callID: 'c1', tool: 'bash', input: { command: 'ls' } } }, sessionID: 's1' },
    ]);
    wrapToolPartAssembly(rt);
    const out = await collect((await rt.global.event()).stream);
    const partEvt = out.find((e) => e.payload.type === 'message.part.updated');
    expect(partEvt.payload.properties.part.id).toBe('toolpart_c1');
    expect(partEvt.payload.properties.part.state.status).toBe('running');
  });

  test('call→result 序列：同 part.id 两帧，终帧 completed', async () => {
    const rt = fakeRuntime([
      { payload: { type: 'tool.call', properties: { sessionID: 's1', callID: 'c1', tool: 'read', input: { filePath: '/a' } } }, sessionID: 's1' },
      { payload: { type: 'tool.result', properties: { sessionID: 's1', callID: 'c1', output: [{ type: 'text', text: 'data' }] } }, sessionID: 's1' },
    ]);
    wrapToolPartAssembly(rt);
    const out = await collect((await rt.global.event()).stream);
    const parts = out.filter((e) => e.payload.type === 'message.part.updated');
    expect(parts).toHaveLength(2);
    expect(parts[0].payload.properties.part.id).toBe('toolpart_c1');
    expect(parts[1].payload.properties.part.id).toBe('toolpart_c1');
    expect(parts[1].payload.properties.part.state.status).toBe('completed');
    expect(parts[1].payload.properties.part.state.output).toBe('data');
  });

  test('锚点学习：先过 text part，后续工具 part 挂同一 messageID', async () => {
    const rt = fakeRuntime([
      { payload: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm-real', type: 'text', text: 'x' } } }, sessionID: 's1' },
      { payload: { type: 'tool.call', properties: { sessionID: 's1', callID: 'c1', tool: 'bash', input: {} } }, sessionID: 's1' },
    ]);
    wrapToolPartAssembly(rt);
    const out = await collect((await rt.global.event()).stream);
    const toolEvt = out.filter((e) => e.payload.type === 'message.part.updated').at(-1);
    expect(toolEvt.payload.properties.part.messageID).toBe('m-real');
  });

  test('无 {stream} 包装的结果原样返回', async () => {
    const bare = { stream: undefined };
    const rt = { global: { event: async () => 42 as any } };
    wrapToolPartAssembly(rt);
    expect(await rt.global.event()).toBe(42);
    void bare;
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/tool-part-assembler-stream.test.ts --runInBand`
Expected: FAIL（`wrapToolPartAssembly` 未导出）

- [ ] **Step 3: 实现 wrapper**（追加到 `gateway/src/runtime/tool-part-assembler.ts`）

```ts
/** 从映射后的 canonical 事件取原语载荷（sessionID 注入在 properties，兼容 evt.sessionID 兜底）。 */
function primitiveOf(evt: any): any {
  const props = evt?.payload?.properties ?? {};
  return { ...props, sessionID: props.sessionID ?? evt?.sessionID };
}

/**
 * 包装 runtime.global.event()：三原语进 assembler 合成 ToolPart 快照，其余透传。
 * 必须在 wrapGlobalEventStream 之后应用（消费映射后的事件流）。
 * opencode 无三原语 → 恒等直通。
 */
export function wrapToolPartAssembly(rt: any): void {
  const assembler = new ToolPartAssembler();
  const orig = rt.global.event.bind(rt.global);
  rt.global.event = async () => {
    const result = await orig();
    const stream = result?.stream ?? result;
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return result;
    const mapped = (async function* () {
      for await (const raw of stream) {
        const t = raw?.payload?.type;
        if (t === 'tool.call') { yield* assembler.applyCall(primitiveOf(raw)); continue; }
        if (t === 'tool.delta') { yield* assembler.applyDelta(primitiveOf(raw)); continue; }
        if (t === 'tool.result') { yield* assembler.applyResult(primitiveOf(raw)); continue; }
        assembler.observeAnchor(raw);
        yield raw;
      }
    })();
    return result?.stream ? { ...result, stream: mapped } : mapped;
  };
}
```

- [ ] **Step 4: index.ts 接线**

`gateway/src/index.ts`（~line 97）CANONICAL_TYPE_SET 并入三原语：

```ts
import { wrapToolPartAssembly, TOOL_PRIMITIVE_TYPES } from './runtime/tool-part-assembler';

/** canonical 词汇表全集（事件映射加载期校验 + 插件流包装用）。
 *  三原语是 assembler 内部入口类型：可校验、可映射，但不广播（见 handleOpencodeEvent 底线）。 */
const CANONICAL_TYPE_SET: ReadonlySet<string> = new Set([
  ...Object.keys(EVENT_FLOW_MATRIX),
  ...RUNTIME_NATIVE_DROPPED,
  ...TOOL_PRIMITIVE_TYPES,
]);
```

`handleOpencodeEvent`（~line 1070，`RUNTIME_NATIVE_DROPPED` 检查后）加防漏底线：

```ts
    // 工具三原语属 assembler 内部入口：正常路径已被 wrapToolPartAssembly 消费，
    // 漏到这里说明装配层未接线——丢弃防广播污染（tool part 只能以合成快照形态出站）。
    if (TOOL_PRIMITIVE_TYPES.has(f.type)) return;
```

`createRuntime` 两分支应用 wrapper（plugin 分支在 `wrapGlobalEventStream` 之后、`wrapRuntimeIdentity` 之前；builtin 分支同理）：

```ts
          // plugin 分支（wrapGlobalEventStream(rt, ...) 之后）：
          wrapToolPartAssembly(rt); // 三原语 → ToolPart 快照；必须在映射包装之后
          log.info(`[Runtime] using plugin runtime ...`);
          return this.wrapRuntimeIdentity(rt);
```
```ts
    // builtin 分支：
    if (builtin) {
      const rt = await builtin.createRuntime(createRuntimePluginContext(undefined));
      wrapToolPartAssembly(rt); // opencode 无三原语，恒等直通
      return this.wrapRuntimeIdentity(rt);
    }
```

- [ ] **Step 5: 跑测试 + 全量**

Run: `cd gateway && npx jest tests/unit/runtime/tool-part-assembler-stream.test.ts tests/unit/runtime/tool-part-assembler.test.ts --runInBand`
Expected: PASS（20 例）
Run: `cd gateway && npm run build`
Expected: tsc 通过

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/tool-part-assembler.ts gateway/tests/unit/runtime/tool-part-assembler-stream.test.ts gateway/src/index.ts
git commit -m "feat(gateway): 接线 ToolPartAssembler 到 runtime 事件流（三原语白名单 + 防漏底线）"
```

---

### Task 3: pi 映射改造（tool_call/tool_result → 三原语）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts:17-18`
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`（目标行为变更，逐条对照更新）

**Interfaces:**
- Consumes: pi 原生事件形状（`pi-coding-agent/dist/core/extensions/types.d.ts`）：`tool_call = { type, toolCallId, toolName, input }`；`tool_result = { type, toolCallId, toolName, input, content: (TextContent|ImageContent)[], isError }`。
- Produces: 映射产 `tool.call` / `tool.result` 原语，供 Task 2 assembler 消费；pi 桌面工具卡首次可渲染。

- [ ] **Step 1: 改测试为目标行为**

`gateway/tests/unit/runtime/pi-events.test.ts` 中 tool_call/tool_result 两条断言改为：

```ts
  test('tool_call → tool.call 原语', () => {
    const out = translatePiEvent({ type: 'tool_call', toolCallId: 'tc1', toolName: 'bash', input: { command: 'ls' } }, 's1');
    expect(out).toEqual({
      payload: { type: 'tool.call', properties: { callID: 'tc1', tool: 'bash', input: { command: 'ls' }, sessionID: 's1' } },
      sessionID: 's1', directory: undefined,
    });
  });

  test('tool_result → tool.result 原语（content 数组原样过，assembler coerce）', () => {
    const content = [{ type: 'text', text: 'ok' }];
    const out = translatePiEvent({ type: 'tool_result', toolCallId: 'tc1', toolName: 'bash', input: {}, content, isError: false }, 's1');
    expect(out).toEqual({
      payload: { type: 'tool.result', properties: { callID: 'tc1', tool: 'bash', isError: false, output: content, sessionID: 's1' } },
      sessionID: 's1', directory: undefined,
    });
  });
```

（其余 pi 映射断言零修改。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts --runInBand`
Expected: FAIL（现映射产 part.type tool-call/tool-result）

- [ ] **Step 3: 改映射表**

`gateway/src/runtime/pi/pi-events.ts` 第 17-18 行替换为：

```ts
  { from: 'tool_call', to: 'tool.call',
    fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' }, input: { path: '$.input' } } },
  { from: 'tool_result', to: 'tool.result',
    fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' },
              isError: { path: '$.isError' }, output: { path: '$.content' } } },
```

- [ ] **Step 4: 跑测试确认通过 + 关联套件**

Run: `cd gateway && npx jest tests/unit/runtime/pi-events.test.ts tests/unit/runtime/tool-part-assembler-stream.test.ts tests/unit/runtime/loader-event-mappings.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-events.ts gateway/tests/unit/runtime/pi-events.test.ts
git commit -m "feat(gateway): pi 工具事件映射改产三原语（dogfood ToolPartAssembler）"
```

---

### Task 4: normalizeMessages 契约 + messages 路由接线

**Files:**
- Modify: `gateway/src/runtime/contract.ts:216`（session namespace 增可选方法）
- Modify: `gateway/src/index.ts:5617`（messages 路由过 normalizer）
- Test: `gateway/tests/unit/runtime/normalize-messages-route.test.ts`（新）

**Interfaces:**
- Consumes: 无。
- Produces: `RuntimeClient.session.normalizeMessages?(raw: any[]): Array<{ info: any; parts: any[] }>`（可选，缺省恒等）；路由对结果应用该归一。

- [ ] **Step 1: 写失败测试**（纯函数级：模拟路由归一逻辑）

路由在 index.ts 内部不可直接单测，提取纯函数 `applyNormalizeMessages(runtime, rawData)` 到新文件 `gateway/src/runtime/normalize-messages.ts`：

```ts
// gateway/tests/unit/runtime/normalize-messages-route.test.ts
import { applyNormalizeMessages } from '../../../src/runtime/normalize-messages';

describe('applyNormalizeMessages', () => {
  test('runtime 无 normalizeMessages → 恒等', () => {
    const raw = [{ info: { id: 'm1' }, parts: [] }];
    expect(applyNormalizeMessages({ session: {} } as any, raw)).toBe(raw);
  });
  test('有 normalizeMessages → 应用', () => {
    const rt = { session: { normalizeMessages: (raw: any[]) => raw.map(() => ({ info: { id: 'x' }, parts: [] })) } } as any;
    expect(applyNormalizeMessages(rt, [{}, {}])).toEqual([{ info: { id: 'x' }, parts: [] }, { info: { id: 'x' }, parts: [] }]);
  });
  test('normalizeMessages 抛错 → fail-open 回原数组', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => { throw new Error('bad'); } } } as any;
    expect(applyNormalizeMessages(rt, raw)).toBe(raw);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/normalize-messages-route.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`gateway/src/runtime/normalize-messages.ts`（新）：

```ts
/** session.messages 历史 DTO 归一：runtime 声明 normalizeMessages 则应用，否则恒等。fail-open。 */
export function applyNormalizeMessages(runtime: any, rawData: any[]): any[] {
  const fn = runtime?.session?.normalizeMessages;
  if (typeof fn !== 'function') return rawData;
  try {
    return fn.call(runtime.session, rawData);
  } catch {
    return rawData;
  }
}
```

`gateway/src/runtime/contract.ts` session namespace（`messages(...)` 行后）加：

```ts
    /** 可选：原生历史消息 → opencode {info, parts} DTO（缺省恒等；pi 等分离模型 runtime 用）。 */
    normalizeMessages?(raw: any[]): Array<{ info: any; parts: any[] }>;
```

`gateway/src/index.ts` messages 路由（line 5617 `const rawData = result.data || [];` 之后）：

```ts
            const normalized = applyNormalizeMessages(this.runtime, rawData);
```
（后续 `Array.isArray(rawData)` 改为 `normalized`，import 加 `applyNormalizeMessages`。）

- [ ] **Step 4: 跑测试 + build**

Run: `cd gateway && npx jest tests/unit/runtime/normalize-messages-route.test.ts --runInBand && npm run build`
Expected: PASS + tsc 通过

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/normalize-messages.ts gateway/src/runtime/contract.ts gateway/src/index.ts gateway/tests/unit/runtime/normalize-messages-route.test.ts
git commit -m "feat(gateway): session.normalizeMessages 契约 + messages 路由历史 DTO 归一"
```

---

### Task 5: pi normalizeMessages 实现

**Files:**
- Create: `gateway/src/runtime/pi/pi-message-normalize.ts`
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（session namespace 挂 normalizeMessages）
- Test: `gateway/tests/unit/runtime/pi-message-normalize.test.ts`

**Interfaces:**
- Consumes: pi-ai Message 形状（`pi-ai/dist/types.d.ts`）：UserMessage / AssistantMessage（content: text|thinking|toolCall）/ ToolResultMessage（`role:'toolResult'`, toolCallId, content, isError, timestamp）；`coerceOutput`（Task 1）。
- Produces: `normalizePiMessages(raw: any[]): Array<{ info; parts }>`——toolResult 被消费进 ToolCall 对应 part；part.id = `toolpart_<toolCallId>`（与 Task 1 assembler 同规则，live/历史同 id 去重）。

- [ ] **Step 1: 写失败测试**

```ts
// gateway/tests/unit/runtime/pi-message-normalize.test.ts
import { normalizePiMessages } from '../../../src/runtime/pi/pi-message-normalize';

const T = 1_700_000_000_000;

describe('normalizePiMessages', () => {
  test('user 文本 → text part', () => {
    const out = normalizePiMessages([{ role: 'user', content: 'hi', timestamp: T }]);
    expect(out).toHaveLength(1);
    expect(out[0].info.role).toBe('user');
    expect(out[0].parts[0]).toMatchObject({ type: 'text', text: 'hi' });
  });

  test('assistant text + thinking + toolCall（有 result）→ 三 part', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '看一下' },
        { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'ls' } },
      ] },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'file.txt' }], isError: false, timestamp: T + 5 },
    ]);
    expect(out).toHaveLength(1); // toolResult 不产顶层条目
    const parts = out[0].parts;
    expect(parts.map((p) => p.type)).toEqual(['reasoning', 'text', 'tool']);
    const tool = parts[2];
    expect(tool.id).toBe('toolpart_tc1');
    expect(tool.callID).toBe('tc1');
    expect(tool.tool).toBe('bash');
    expect(tool.state.status).toBe('completed');
    expect(tool.state.output).toBe('file.txt');
    expect(tool.state.input).toEqual({ command: 'ls' });
    expect(tool.state.time.end).toBe(T + 5);
  });

  test('toolCall 无 result → running（历史半截会话）', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: {} }] },
    ]);
    expect(out[0].parts[0].state.status).toBe('running');
  });

  test('toolResult isError → error part', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'tc1', name: 'bash', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true, timestamp: T + 1 },
    ]);
    expect(out[0].parts[0].state).toMatchObject({ status: 'error', error: 'boom' });
  });

  test('多 tool 混杂文本保持顺序；孤儿 toolResult 丢弃', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'text', text: 'a' },
        { type: 'toolCall', id: 't1', name: 'read', arguments: {} },
        { type: 'text', text: 'b' },
        { type: 'toolCall', id: 't2', name: 'grep', arguments: {} },
      ] },
      { role: 'toolResult', toolCallId: 'orphan', toolName: 'x', content: [], isError: false, timestamp: T },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].parts.map((p) => p.type)).toEqual(['text', 'tool', 'text', 'tool']);
  });

  test('id 稳定性：同输入同输出（幂等）', () => {
    const raw = [{ role: 'assistant', timestamp: T, content: [{ type: 'text', text: 'x' }] }];
    expect(normalizePiMessages(raw)).toEqual(normalizePiMessages(raw));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/pi-message-normalize.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// gateway/src/runtime/pi/pi-message-normalize.ts
/** pi 历史消息 → opencode {info, parts} DTO。
 *  ToolCall content block + ToolResultMessage（toolCallId 关联）→ 单 ToolPart；
 *  toolResult 被消费不产顶层条目；part.id = toolpart_<toolCallId>（与 assembler 同规则）。 */
import { coerceOutput } from '../tool-part-assembler';

export function normalizePiMessages(raw: any[]): Array<{ info: any; parts: any[] }> {
  const results = new Map<string, any>();
  for (const m of raw) {
    if (m?.role === 'toolResult' && typeof m.toolCallId === 'string') results.set(m.toolCallId, m);
  }
  const out: Array<{ info: any; parts: any[] }> = [];
  let i = 0;
  for (const m of raw) {
    i++;
    const ts = typeof m?.timestamp === 'number' ? m.timestamp : 0;
    if (m?.role === 'user') {
      const text = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? m.content.map((c: any) => (c?.type === 'text' ? c.text ?? '' : '')).join('') : '');
      const id = `piu_${ts}_${i}`;
      out.push({ info: { id, role: 'user', time: { created: ts } }, parts: text ? [{ id: `${id}_t`, type: 'text', text }] : [] });
      continue;
    }
    if (m?.role === 'assistant') {
      const id = `pia_${ts}_${i}`;
      const parts: any[] = [];
      let j = 0;
      for (const c of Array.isArray(m.content) ? m.content : []) {
        j++;
        if (c?.type === 'text' && c.text) {
          parts.push({ id: `${id}_t${j}`, type: 'text', text: c.text });
        } else if (c?.type === 'thinking' && c.thinking) {
          parts.push({ id: `${id}_r${j}`, type: 'reasoning', text: c.thinking });
        } else if (c?.type === 'toolCall' && typeof c.id === 'string') {
          const res = results.get(c.id);
          const input = c.arguments ?? {};
          parts.push({
            id: `toolpart_${c.id}`, type: 'tool', tool: c.name, callID: c.id,
            state: res
              ? (res.isError
                  ? { status: 'error', input, error: coerceOutput(res.content), time: { start: ts, end: typeof res.timestamp === 'number' ? res.timestamp : ts } }
                  : { status: 'completed', input, output: coerceOutput(res.content), title: c.name, metadata: {}, time: { start: ts, end: typeof res.timestamp === 'number' ? res.timestamp : ts } })
              : { status: 'running', input, time: { start: ts } },
          });
        }
      }
      out.push({ info: { id, role: 'assistant', time: { created: ts, completed: ts } }, parts });
      continue;
    }
    // toolResult 及其他角色：已被消费或不渲染，不产顶层条目
  }
  return out;
}
```

- [ ] **Step 4: 挂到 pi runtime session namespace**

`gateway/src/runtime/plugins/pi-runtime.ts` 的 session namespace（registry.messages 包装处）加：

```ts
import { normalizePiMessages } from '../pi/pi-message-normalize';
// session 对象字面量内：
//   normalizeMessages: normalizePiMessages,
```

- [ ] **Step 5: 跑测试 + build**

Run: `cd gateway && npx jest tests/unit/runtime/pi-message-normalize.test.ts tests/unit/runtime/pi-messages.test.ts tests/unit/runtime/pi-runtime.test.ts --runInBand && npm run build`
Expected: PASS + tsc 通过

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/pi/pi-message-normalize.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/pi-message-normalize.test.ts
git commit -m "feat(gateway): pi normalizeMessages — ToolCall/toolResult 归并 opencode DTO"
```

---

### Task 6: dry-event 试衣间加 assembler 跳

**Files:**
- Modify: `gateway/src/routes/dry-event.ts`
- Test: `gateway/tests/unit/routes/dry-event.test.ts`（追加用例）

**Interfaces:**
- Consumes: `ToolPartAssembler`/`TOOL_PRIMITIVE_TYPES`（Task 1）；现有 `handleDryEvent`。
- Produces: 响应新增可选 `assembled` 字段（映射后为三原语时，新 assembler 实例的消费输出）。

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 gateway/tests/unit/routes/dry-event.test.ts
  test('映射到 tool.call → assembled 回显 ToolPart 快照，facets 跳过', async () => {
    const res = await post({ plugin: 'pi', event: { type: 'tool_call', toolCallId: 'tc1', toolName: 'bash', input: {} }, sessionID: 's1' });
    expect(res.mapping).toEqual({ matched: true, to: 'tool.call' });
    const part = res.assembled?.find((e: any) => e.payload?.type === 'message.part.updated')?.payload?.properties?.part;
    expect(part?.id).toBe('toolpart_tc1');
    expect(part?.type).toBe('tool');
  });
```
（`post` helper 按该文件既有风格复用；若文件用 mock req/res，则按既有模式构造。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/routes/dry-event.test.ts --runInBand`
Expected: FAIL（无 `assembled` 字段）

- [ ] **Step 3: 实现**

`gateway/src/routes/dry-event.ts`：import assembler；在映射跳之后、facet 提取之前插入：

```ts
import { ToolPartAssembler, TOOL_PRIMITIVE_TYPES } from '../runtime/tool-part-assembler';

// （handleDryEvent 内，mapped 确定后）
  if (TOOL_PRIMITIVE_TYPES.has(mapped?.payload?.type ?? '')) {
    const assembler = new ToolPartAssembler();
    const props = mapped.payload.properties ?? {};
    const p = { ...props, sessionID: props.sessionID ?? mapped.sessionID ?? 'dry' };
    const assembled =
      mapped.payload.type === 'tool.call' ? assembler.applyCall(p)
      : mapped.payload.type === 'tool.delta' ? assembler.applyDelta(p)
      : assembler.applyResult(p);
    send(200, {
      ...(body?.plugin ? { plugin: body.plugin, mapping } : {}),
      type: mapped.payload.type, known: true, facets: null, warnings: [],
      assembled,
    });
    return;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/routes/dry-event.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/dry-event.ts gateway/tests/unit/routes/dry-event.test.ts
git commit -m "feat(gateway): dry-event 试衣间支持工具三原语 assembler 跳"
```

---

### Task 7: 全量回归 + 文档收口

**Files:**
- Modify: `AGENTS.md`（§5.19 加 assembler/normalizer 段落）
- Modify: `docs/superpowers/specs/2026-10-12-tool-part-compat-design.md`（状态：草稿 → 已批准/已实施）

- [ ] **Step 1: 全量 gateway 测试**

Run: `cd gateway && npm test`
Expected: 全绿（新增 ~26 例；pi-events 目标行为变更断言已更新）

- [ ] **Step 2: 桌面/TUI 零改动验证**

Run: `cd packages/desktop && bun test`
Expected: 全绿（零改动即兼容证明）

- [ ] **Step 3: AGENTS.md 更新**（§5.19 事件映射注册小节末尾追加）

```markdown
- **工具 part 合帧（2026-10-12）**：`runtime/tool-part-assembler.ts` 的 `ToolPartAssembler`（per-session、callID 键控状态机）把「call/result 分离」runtime 的三原语（`tool.call`/`tool.delta`/`tool.result`，内部类型不进公开词汇表）合帧为 opencode 形状 ToolPart 快照（part.id = `toolpart_<callID>`）；`wrapToolPartAssembly` 在 `wrapGlobalEventStream` 之后接线（opencode 恒等直通），`handleOpencodeEvent` 有三原语防漏底线。历史路径：契约可选 `session.normalizeMessages`（缺省恒等），gateway messages 路由统一过；pi 实现 `runtime/pi/pi-message-normalize.ts`（ToolCall block + toolCallId 归并）。spec：`docs/superpowers/specs/2026-10-12-tool-part-compat-design.md`。
```

spec 文件状态行改 `已批准并实施（2026-10-12）`。

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-12-tool-part-compat-design.md
git commit -m "docs: AGENTS §5.19 工具 part 合帧 + spec 状态收口"
```

---

## Self-Review 记录

- **spec 覆盖**：§3 架构→Task 2；§4 assembler→Task 1；§5 eventMappings 扩展→Task 2 白名单 + Task 3 pi；§6 normalizer→Task 4/5；§7 pi dogfood→Task 3/5；§8 dry-event→Task 6；§9 测试→各 Task 内嵌；§10 风险→assembler dropSession/防漏底线/output delta 默认关。✓
- **占位符扫描**：无 TBD；dry-event 测试的 `post` helper 注明「按文件既有风格」（该文件已有 mock 模式，属合理指引非占位）。
- **类型一致性**：`toolpart_<callID>` 在 assembler（Task 1）与 normalizer（Task 5）一致；`coerceOutput` 从 Task 1 导出、Task 5 复用；三原语名三处一致。
