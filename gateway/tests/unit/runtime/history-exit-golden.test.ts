/**
 * 历史 / SSE 出口 golden —— opencode、pi、claude 三个 canonical 生产者共用同一契约
 * （spec 2026-11-02 §8 / §11「所有历史消费者使用同一 flat golden；所有 SSE 消费者
 * 使用同一 canonical golden」）。
 *
 * 这里钉的是**出口**而不是某个 adapter 的实现：
 *   ① 历史：三种原生历史 normalize 后都必须是 MAFW flat DTO，且经
 *      `GET /api/sessions/:id/messages` 原样出站（不增键、不复活 wire 信封）。
 *   ② SSE：三种原生事件经声明表翻译后，`message.updated` 只携带 `properties.message`，
 *      工具卡 id 与历史侧同方案（`toolpart_<callID>`），无 `info` 残留。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOpencodeHistory } from '../../../src/runtime/opencode-history';
import { normalizePiMessages } from '../../../src/runtime/pi/pi-message-normalize';
import { normalizeClaudeHistory } from '../../../../adapters/claude/src/history';
import { applyEventMappings, canonicalTypeSet } from '../../../src/runtime/event-mapper';
import { mafwBroadcast } from '../../../src/runtime/event-broadcast';
import { ToolPartAssembler } from '../../../src/runtime/tool-part-assembler';
import {
  OPENCODE_EVENT_MAPPINGS, OPENCODE_EVENT_SOURCE, OPENCODE_TRANSFORM_EVENT,
} from '../../../src/runtime/opencode-events';
import { PI_EVENT_MAPPINGS, PI_EVENT_SOURCE, piTransformEvent } from '../../../src/runtime/pi/pi-events';
import { CLAUDE_EVENT_MAPPINGS, CLAUDE_EVENT_SOURCE, claudeTransformEvent } from '../../../../adapters/claude/src/events';
import { handleSessionHistory } from '../../../src/routes/session-history';
import { normalizeFacadeHistory } from '../../../src/runtime/normalize-messages';
import type * as http from 'http';

const T = 1_700_000_000_000;
const SID = 'ses_gold';

// ─── ① 三种原生历史 → flat ────────────────────────────────────────────────────

const OPENCODE_HISTORY = [
  {
    info: {
      id: 'mu_1', sessionID: SID, role: 'user', time: { created: T },
      model: { providerID: 'p', modelID: 'm' },
    },
    parts: [{ id: 'q1', type: 'text', text: '跑一下' }],
  },
  {
    info: {
      id: 'ma_1', sessionID: SID, role: 'assistant', time: { created: T + 1, completed: T + 2 },
      finish: 'stop', modelID: 'm', providerID: 'p', parentID: 'mu_1',
      tokens: { input: 10, output: 5 },
    },
    parts: [
      { id: 'a1', type: 'text', text: '好' },
      {
        id: 'prt_1', type: 'tool', callID: 'c1', tool: 'bash',
        state: { status: 'completed', input: { command: 'ls' }, output: 'a', title: 'bash', metadata: {}, time: { start: T + 1, end: T + 2 } },
      },
    ],
  },
];

const PI_HISTORY = [
  { role: 'user', content: '跑一下', timestamp: T },
  {
    role: 'assistant', timestamp: T + 1,
    content: [
      { type: 'text', text: '好' },
      { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
    ],
  },
  { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'a' }], isError: false, timestamp: T + 2 },
];

const CLAUDE_HISTORY = [
  { uuid: 'u1', role: 'user', content: '跑一下' },
  {
    uuid: 'a1', role: 'assistant', model: 'claude-x', stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [
      { type: 'text', text: '好' },
      { type: 'tool_use', id: 'c1', name: 'bash', input: { command: 'ls' } },
    ],
  },
  { uuid: 'u2', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'a', is_error: false }] },
];

interface HistoryProducer {
  name: 'opencode' | 'pi' | 'claude';
  produce: () => any[];
  /** 历史侧工具 part id 方案（opencode 保留 serve 原生 part id）。 */
  toolPartId: (part: any) => string;
}

const PRODUCERS: HistoryProducer[] = [
  { name: 'opencode', produce: () => normalizeOpencodeHistory(OPENCODE_HISTORY) as any[], toolPartId: (part) => part.id },
  { name: 'pi', produce: () => normalizePiMessages(PI_HISTORY) as any[], toolPartId: (part) => part.id },
  { name: 'claude', produce: () => normalizeClaudeHistory(CLAUDE_HISTORY) as any[], toolPartId: (part) => part.id },
];

function toolParts(messages: any[]): any[] {
  return messages.flatMap((message) => (message.content ?? []).filter((part: any) => part?.type === 'tool'));
}

describe('history exit golden: three producers, one flat contract', () => {
  it.each(PRODUCERS)('$name history is flat MAFW View DTO (no wire envelope)', ({ name, produce }) => {
    const messages = produce();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    for (const message of messages) {
      expect(message.role === 'user' || message.role === 'assistant').toBe(true);
      expect(Array.isArray(message.content)).toBe(true);
      // 旧 wire 信封与 runtime 原生私有封套都不允许出现在出口。
      expect('info' in message).toBe(false);
      expect('parts' in message).toBe(false);
      expect('native' in message).toBe(false);
      for (const part of message.content) {
        expect(typeof part.id).toBe('string');
        expect(typeof part.type).toBe('string');
        if (part.type === 'text') expect(typeof part.text).toBe('string');
      }
    }
    expect(messages[0].role).toBe('user');
    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant).toBeTruthy();
    if (name === 'claude') {
      // 已登记缺口：claude SDK 的历史消息不带时间戳，`time` 可选缺失（View DTO 允许）。
      expect(assistant.time?.created).toBeUndefined();
    } else {
      expect(assistant.time?.created).toBeGreaterThan(0);
    }
  });

  it.each(PRODUCERS)('$name tool parts share the live snapshot shape', ({ produce }) => {
    const tools = toolParts(produce());
    expect(tools).toHaveLength(1);
    const [tool] = tools;
    expect(tool.callID).toBe('c1');
    expect(typeof tool.tool).toBe('string');
    expect(tool.state).toBeTruthy();
    expect(['pending', 'running', 'completed', 'error']).toContain(tool.state.status);
    expect(tool.state.input).toEqual({ command: 'ls' });
    if (tool.state.status === 'completed') expect(typeof tool.state.output).toBe('string');
  });

  it('pi/claude history tool ids match the live assembler scheme (dedupe is real)', async () => {
    const assembler = new ToolPartAssembler({ now: () => T });
    const live = assembler.applyCall({ sessionID: SID, callID: 'c1', tool: 'bash', input: { command: 'ls' } });
    const livePart = live[live.length - 1].payload.properties.part;
    for (const producer of PRODUCERS.filter((entry) => entry.name !== 'opencode')) {
      const [tool] = toolParts(producer.produce());
      expect(producer.toolPartId(tool)).toBe(livePart.id);
      expect(livePart.id).toBe('toolpart_c1');
    }
  });
});

// ─── ② 历史出口：route 原样出站 / wire 成员 fail-closed ───────────────────────

function mockRes() {
  const res: any = {
    status: 0, body: '',
    writeHead(status: number) { this.status = status; },
    end(body?: string) { this.body = body ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

async function callHistory(messages: unknown, nextCursor: string | null = null) {
  const res = mockRes();
  const runtime = { session: { messages: async () => ({ data: messages, nextCursor }) } };
  const url = `/api/sessions/${SID}/messages`;
  await handleSessionHistory(
    { method: 'GET', url } as http.IncomingMessage,
    res,
    url,
    { getRuntime: () => runtime as any },
  );
  return JSON.parse(res.body);
}

describe('history exit golden: GET /api/sessions/:id/messages', () => {
  it.each(PRODUCERS)('$name page passes through byte-identical', async ({ produce }) => {
    const messages = produce();
    const body = await callHistory(messages, 'cursor_2');
    expect(body.data).toEqual(JSON.parse(JSON.stringify(messages)));
    expect(body.nextCursor).toBe('cursor_2');
    expect(body.data[0].info).toBeUndefined();
    expect(body.data[0].parts).toBeUndefined();
  });

  it('wire-shaped members are dropped, never resurrected at the facade exit', async () => {
    // facade fail-closed（spec §9.1）：未声明 normalizeMessages 的 adapter 必须直接交付
    // flat；wire 成员被丢弃并记录违例，而不是经第二条兼容通道「救回」。
    const violations: string[] = [];
    const dropped = normalizeFacadeHistory({ session: {} }, OPENCODE_HISTORY, (reason) => violations.push(reason));
    expect(dropped).toEqual([]);
    expect(violations.join('|')).toMatch(/non-flat member/);

    const declared = normalizeFacadeHistory(
      { session: { normalizeMessages: (rows: unknown) => normalizePiMessages(rows as any[]) } },
      PI_HISTORY,
    );
    expect(declared).toEqual(JSON.parse(JSON.stringify(normalizePiMessages(PI_HISTORY))));
    expect(Array.isArray(declared)).toBe(true);
  });

  it('the removed format parameter cannot change the page', async () => {
    const messages = PRODUCERS[0].produce();
    const plain = await callHistory(messages);
    const res = mockRes();
    const url = `/api/sessions/${SID}/messages?format=wire`;
    const runtime = { session: { messages: async () => ({ data: messages, nextCursor: null }) } };
    await handleSessionHistory({ method: 'GET', url } as http.IncomingMessage, res, url, { getRuntime: () => runtime as any });
    expect(JSON.parse(res.body)).toEqual(plain);
  });
});

// ─── ③ SSE golden：三种生产者 → canonical envelope ────────────────────────────

const IS_CANONICAL = (type: string) => canonicalTypeSet().has(type);

const OPENCODE_ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};
const PI_ENTRY = {
  eventSource: PI_EVENT_SOURCE,
  eventMappings: PI_EVENT_MAPPINGS,
  transformEvent: piTransformEvent,
};
const CLAUDE_ENTRY = {
  eventSource: CLAUDE_EVENT_SOURCE,
  eventMappings: CLAUDE_EVENT_MAPPINGS,
  transformEvent: claudeTransformEvent,
};

const FIXTURE = join(__dirname, '../../fixtures/events/runtime-raw-session.jsonl');

function opencodeCanonical(): any[] {
  const lines = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return lines.flatMap((event) => applyEventMappings(event, OPENCODE_ENTRY, IS_CANONICAL));
}

function piCanonical(events: any[]): any[] {
  return events.flatMap((event) => applyEventMappings(event, PI_ENTRY, IS_CANONICAL));
}

function claudeCanonical(events: any[]): any[] {
  return events.flatMap((event) => applyEventMappings(event, CLAUDE_ENTRY, IS_CANONICAL));
}

describe('SSE exit golden: canonical message.updated across opencode / pi / claude', () => {
  it('opencode: fixture replay yields properties.message (no info)', () => {
    const events = opencodeCanonical();
    const update = events.find((event) => event.payload.type === 'message.updated');
    expect(update).toBeTruthy();
    const envelope = mafwBroadcast({ ...update.payload, sessionID: update.sessionID });
    const properties = envelope.data.properties;
    expect(properties.message?.id).toBeTruthy();
    expect(properties.message?.role).toBeTruthy();
    expect('info' in properties).toBe(false);
  });

  it('pi: message_end yields properties.message with stable id + role (live/history 同 id)', () => {
    const events = piCanonical([{
      type: 'message_end', sessionID: SID,
      message: { role: 'assistant', timestamp: 1_700_000_000_000, content: [{ type: 'text', text: '好' }], stopReason: 'stop' },
    }]);
    const update = events.find((event) => event.payload.type === 'message.updated')!;
    const envelope = mafwBroadcast({ ...update.payload, sessionID: SID });
    const message = envelope.data.properties.message;
    expect(message.id).toBe('pia_1700000000000');
    expect(message.role).toBe('assistant');
    expect(message.stopReason).toBe('end_turn');
    // live 形态不写 time.completed（pi step 结算单载体 = turn_end → step-finish）
    expect(message.time).toEqual({ created: 1_700_000_000_000 });
    expect(message.content.map((p: any) => p.id)).toEqual(['pia_1700000000000_t1']);
    expect('info' in envelope.data.properties).toBe(false);
  });

  it('claude: assistant event yields properties.message with id + tool primitive on one scheme', () => {
    const events = claudeCanonical([{
      type: 'assistant', session_id: SID, uuid: 'a1',
      message: {
        id: 'msg_1', role: 'assistant', stop_reason: 'end_turn', model: 'claude-x',
        content: [
          { type: 'text', text: '好' },
          { type: 'tool_use', id: 'c1', name: 'bash', input: { command: 'ls' } },
        ],
      },
    }]);
    const update = events.find((event) => event.payload.type === 'message.updated')!;
    const envelope = mafwBroadcast({ ...update.payload, sessionID: SID });
    expect(envelope.data.properties.message.id).toBe('cla_a1');
    expect(envelope.data.properties.message.role).toBe('assistant');
    expect('info' in envelope.data.properties).toBe(false);
    // 工具走三原语，由 gateway assembler 合帧（id 与历史一致 → 天然去重）。
    const call = events.find((event) => event.payload.type === 'tool.call')!;
    expect(call).toBeTruthy();
    const assembler = new ToolPartAssembler({ now: () => T });
    const frames = assembler.applyCall(call.payload.properties as any);
    const part = frames[frames.length - 1].payload.properties.part;
    expect(part.id).toBe('toolpart_c1');
    expect(part.state.status).toBe('running');
  });

  it('all three producers only emit canonical vocabulary', () => {
    const canonical = new Set(canonicalTypeSet());
    const primitive = new Set(['tool.call', 'tool.delta', 'tool.result']);
    const produced = [
      ...opencodeCanonical(),
      ...piCanonical([
        { type: 'message_end', sessionID: SID, message: { role: 'assistant' } },
        { type: 'tool_execution_start', sessionID: SID, toolCallId: 'c1', toolName: 'bash', args: {} },
      ]),
      ...claudeCanonical([
        { type: 'assistant', session_id: SID, uuid: 'a1', message: { id: 'm1', role: 'assistant', content: [] } },
      ]),
    ];
    const unknown = produced
      .map((event) => event.payload.type)
      .filter((type) => !canonical.has(type) && !primitive.has(type));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('reverse fixture: a wire-shaped message.updated is rejected explicitly', () => {
    // 旧 wire 帧（只有 properties.info）在 claude 方言里不是合法原生类型：default-deny
    // 必须**真的**返回空数组并走 unmatched 钩子，而不是「碰巧没有 message 字段」。
    const wire = { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    const suppressed: string[] = [];
    const unmatched: string[] = [];
    const out = applyEventMappings(wire, CLAUDE_ENTRY, IS_CANONICAL, {
      onSuppressed: (type) => suppressed.push(type),
      onUnmatched: (type) => unmatched.push(type),
    });
    expect(out).toEqual([]);
    // claude 方言带 transformEvent：未知原生类型走显式 null → onSuppressed（不是静默落空）。
    expect(suppressed).toEqual(['message.updated']);
    expect(unmatched).toEqual([]);
    // 对照：真正的 claude 原生 assistant 事件会被翻译出 message.updated（证明上一条不是「全拒」）。
    const ok = claudeCanonical([{
      type: 'assistant', session_id: SID, uuid: 'a9',
      message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    }]);
    expect(ok.some((event) => event.payload.type === 'message.updated')).toBe(true);
  });
});
