import { applyEventMappings, canonicalIdentity, RUNTIME_IDENTITY_TYPES } from '../../../src/runtime/event-mapper';
import { OPENCODE_EVENT_SOURCE, OPENCODE_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';
import { TOOL_PRIMITIVE_TYPES, ToolPartAssembler } from '../../../src/runtime/tool-part-assembler';

const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
};
const ENTRY_V2 = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V2_EVENT_MAPPINGS,
};
const isCanonical = (t: string) => !!EVENT_FLOW_MATRIX[t];
/** 含工具三原语的 canonical 判定（真实管线 CANONICAL_TYPE_SET 同款） */
const isCanonicalAll = (t: string) => !!EVENT_FLOW_MATRIX[t] || TOOL_PRIMITIVE_TYPES.has(t);

const raw = (type: string, properties: Record<string, any> = {}, extra: Record<string, any> = {}) =>
  ({ directory: '/p', payload: { type, properties }, ...extra });

describe('OPENCODE_EVENT_MAPPINGS（opencode → MAFW 词汇 v2）', () => {
  it.each([
    ['session.idle', 'turn.completed'],
    ['session.error', 'turn.failed'],
    ['message.error', 'turn.failed'],
    ['message.aborted', 'turn.aborted'],
    ['message.part.updated', 'part.updated'],
    ['message.part.delta', 'part.delta'],
    ['message.part.complete', 'part.complete'],
    ['todo.updated', 'plan.updated'],
  ])('%s → %s（passProperties 保富载荷）', (from, to) => {
    const out = applyEventMappings(
      raw(from, { sessionID: 's1', part: { type: 'text', text: 'hi', messageID: 'm1' }, keep: { deep: 1 } }),
      ENTRY,
      isCanonical,
    );
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe(to);
    // 富载荷整段透传（兄弟字段保留）
    expect(out[0].payload.properties.part.text).toBe('hi');
    expect(out[0].payload.properties.keep).toEqual({ deep: 1 });
    // 信封 sessionID 多路径注入 + directory 重注入
    expect(out[0].sessionID).toBe('s1');
    expect(out[0].directory).toBe('/p');
  });

  it('同名收编词经 identity 行放行（恒等翻译，载荷 passProperties 重建）', () => {
    for (const t of ['session.created', 'message.updated', 'permission.asked', 'question.asked', 'session.diff']) {
      const out = applyEventMappings(raw(t, { sessionID: 's1', keep: 1 }), ENTRY, isCanonical);
      expect(out).toHaveLength(1);
      expect(out[0].payload.type).toBe(t);
      expect(out[0].payload.properties.keep).toBe(1);
      expect(out[0].sessionID).toBe('s1');
      expect(out[0].directory).toBe('/p');
    }
  });

  it('session.next.* legacy 族经显式 drop 行丢弃（词汇外新成员同样被拦——default-deny 漏网探测器）', () => {
    // N3 修正（2026-10-21）：drop 行用 SDK 真名（tool.called/progress/success——
    // 旧的 tool.started/updated/ended 是不存在的幽灵名，快照测试钉扎）
    for (const t of [
      'session.next.step.ended', 'session.next.reasoning.ended',
      'session.next.tool.called', 'session.next.tool.progress', 'session.next.tool.success', 'session.next.tool.failed',
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

  it('差异行不劫持 identity：opencode 直接发 canonical 词走恒等行', () => {
    const out = applyEventMappings(raw('turn.completed', { sessionID: 's1' }), ENTRY, isCanonical);
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe('turn.completed');
    expect(out[0].payload.properties.sessionID).toBe('s1');
  });
});

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

describe('OPENCODE_V2_EVENT_MAPPINGS（@v2 混合消费表——next 族为主 + 非 next legacy + 重叠 drop）', () => {
  it('① session.next.prompted → turn.started（prompt/delivery 载荷保留——Review Focus 5）', () => {
    const out = applyEventMappings(
      raw('session.next.prompted', { sessionID: 's1', messageID: 'mu_1', prompt: { text: 'go' }, delivery: 'steer' }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe('turn.started');
    expect(out[0].payload.properties).toMatchObject({ messageID: 'mu_1', prompt: { text: 'go' }, delivery: 'steer' });
    expect(out[0].sessionID).toBe('s1');
  });

  it('②③ 工具原语端到端：called → tool.call → assembler running；input.delta → tool.delta(input) 累积', () => {
    const assembler = new ToolPartAssembler({ now: () => 1000 });
    const [call] = applyEventMappings(
      raw('session.next.tool.called', { sessionID: 's1', assistantMessageID: 'ma_1', callID: 'c1', tool: 'bash', input: { command: 'ls' } }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(call.payload.type).toBe('tool.call');
    expect(call.payload.properties).toMatchObject({ callID: 'c1', tool: 'bash', input: { command: 'ls' }, messageID: 'ma_1' });
    const running = assembler.applyCall(call.payload.properties).at(-1)!;
    expect(running.payload.type).toBe('part.updated');
    expect(running.payload.properties.part).toMatchObject({ id: 'toolpart_c1', type: 'tool', callID: 'c1', tool: 'bash', sessionID: 's1' });
    expect(running.payload.properties.part.state.status).toBe('running');

    const [delta] = applyEventMappings(
      raw('session.next.tool.input.delta', { sessionID: 's1', callID: 'c1', delta: '{"a":1}' }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(delta.payload.type).toBe('tool.delta');
    expect(delta.payload.properties).toMatchObject({ callID: 'c1', kind: 'input', text: '{"a":1}' });
  });

  it('④⑤ tool.success/failed → tool.result → assembler completed/error', () => {
    const assembler = new ToolPartAssembler({ now: () => 1000 });
    const [okRes] = applyEventMappings(
      raw('session.next.tool.success', { sessionID: 's1', assistantMessageID: 'ma_1', callID: 'c1', content: [{ type: 'text', text: 'a\nb' }] }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(okRes.payload.type).toBe('tool.result');
    expect(okRes.payload.properties.callID).toBe('c1');
    assembler.applyCall({ callID: 'c1', tool: 'bash', input: {}, sessionID: 's1', messageID: 'ma_1' });
    const done = assembler.applyResult(okRes.payload.properties).at(-1)!;
    expect(done.payload.properties.part.state.status).toBe('completed');

    const [errRes] = applyEventMappings(
      raw('session.next.tool.failed', { sessionID: 's1', assistantMessageID: 'ma_1', callID: 'c2', error: { name: 'ToolError', data: { message: 'boom' } } }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(errRes.payload.type).toBe('tool.result');
    expect(errRes.payload.properties.isError).toBe(true);
    assembler.applyCall({ callID: 'c2', tool: 'bash', input: {}, sessionID: 's1', messageID: 'ma_1' });
    const failed = assembler.applyResult(errRes.payload.properties).at(-1)!;
    expect(failed.payload.properties.part.state.status).toBe('error');
  });

  it('⑥ text.delta/reasoning.delta → part.delta（partID/messageID/field/delta）', () => {
    const [text] = applyEventMappings(
      raw('session.next.text.delta', { sessionID: 's1', assistantMessageID: 'ma_1', textID: 'pt_1', delta: '你好' }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(text.payload.type).toBe('part.delta');
    // sessionID 注入是 event-mapper 约定行为（SESSION_ID_TARGETS）——用 matchObject
    expect(text.payload.properties).toMatchObject({ partID: 'pt_1', messageID: 'ma_1', field: 'text', delta: '你好' });

    const [reasoning] = applyEventMappings(
      raw('session.next.reasoning.delta', { sessionID: 's1', assistantMessageID: 'ma_1', reasoningID: 'pr_1', delta: '思考' }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(reasoning.payload.properties).toMatchObject({ partID: 'pr_1', messageID: 'ma_1', field: 'text', delta: '思考' });
  });

  it('⑦ compaction 原生对 → session.compacting/compacted', () => {
    const [a] = applyEventMappings(raw('session.next.compaction.started', { sessionID: 's1' }), ENTRY_V2, isCanonicalAll);
    expect(a.payload.type).toBe('session.compacting');
    const [b] = applyEventMappings(raw('session.next.compaction.ended', { sessionID: 's1' }), ENTRY_V2, isCanonicalAll);
    expect(b.payload.type).toBe('session.compacted');
  });

  it('⑧ permission.v2/question.v2 → canonical 名（passProperties 富载荷）', () => {
    const out = applyEventMappings(
      raw('permission.v2.asked', { sessionID: 's1', permission: 'bash', patterns: ['rm*'] }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(out[0].payload.type).toBe('permission.asked');
    expect(out[0].payload.properties.permission).toBe('bash');
  });

  it('⑨ session.error 判别（行序敏感）：MessageAbortedError → turn.aborted；其他 → turn.failed', () => {
    const [aborted] = applyEventMappings(
      raw('session.error', { sessionID: 's1', error: { name: 'MessageAbortedError', data: { message: 'user abort' } } }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(aborted.payload.type).toBe('turn.aborted');

    const [failed] = applyEventMappings(
      raw('session.error', { sessionID: 's1', error: { name: 'ApiError', data: { message: 'boom' } } }),
      ENTRY_V2, isCanonicalAll,
    );
    expect(failed.payload.type).toBe('turn.failed');
  });

  it('⑩ 双发防双计：重叠 legacy 对 drop（suppressed），next 侧单产', () => {
    const suppressed: string[] = [];
    // 同一工具调用的双发对：legacy message.part.updated + next tool.called
    const legacy = applyEventMappings(
      raw('message.part.updated', { sessionID: 's1', part: { id: 'p_x', type: 'tool', callID: 'c1', state: { status: 'running' } } }),
      ENTRY_V2, isCanonicalAll, { onSuppressed: (x) => suppressed.push(x) },
    );
    expect(legacy).toEqual([]);
    const next = applyEventMappings(
      raw('session.next.tool.called', { sessionID: 's1', assistantMessageID: 'ma_1', callID: 'c1', tool: 'bash', input: {} }),
      ENTRY_V2, isCanonicalAll, { onSuppressed: (x) => suppressed.push(x) },
    );
    expect(next.map((e) => e.payload.type)).toEqual(['tool.call']);
    expect(suppressed).toEqual(['message.part.updated']);
  });

  it('⑪ next 孤儿族 drop（F6 处置）', () => {
    for (const t of [
      'session.next.retried', 'session.next.moved', 'session.next.agent.switched', 'session.next.model.switched',
      'session.next.context.updated', 'session.next.synthetic', 'session.next.shell.started', 'session.next.shell.ended',
      'session.next.text.started', 'session.next.text.ended', 'session.next.reasoning.started', 'session.next.reasoning.ended',
      'session.next.step.started', 'session.next.step.ended', 'session.next.step.failed',
      'session.next.compaction.delta', 'session.next.revert.staged', 'session.next.revert.cleared', 'session.next.revert.committed',
      'session.next.tool.input.started', 'session.next.tool.input.ended', 'session.next.prompt.admitted',
    ]) {
      const suppressed: string[] = [];
      expect(applyEventMappings(raw(t, { sessionID: 's1' }), ENTRY_V2, isCanonicalAll, { onSuppressed: (x) => suppressed.push(x) })).toEqual([]);
      expect(suppressed).toEqual([t]);
    }
  });

  it('⑫ 非 next 的 legacy 照常消费（idle/todo/created identity——混合表的 legacy 侧）', () => {
    const [idle] = applyEventMappings(raw('session.idle', { sessionID: 's1' }), ENTRY_V2, isCanonicalAll);
    expect(idle.payload.type).toBe('turn.completed');
    const [todo] = applyEventMappings(raw('todo.updated', { sessionID: 's1' }), ENTRY_V2, isCanonicalAll);
    expect(todo.payload.type).toBe('plan.updated');
    const [created] = applyEventMappings(raw('session.created', { sessionID: 's1' }), ENTRY_V2, isCanonicalAll);
    expect(created.payload.type).toBe('session.created');
    const [msg] = applyEventMappings(raw('message.updated', { sessionID: 's1', info: { id: 'm1', role: 'user' } }), ENTRY_V2, isCanonicalAll);
    expect(msg.payload.type).toBe('message.updated');
  });

  it('@v2 表 drop 集防幽灵：全部 ∈ SDK union 真名（sync 豁免——runtime 原生信封）', () => {
    const dropped = new Set<string>();
    for (const row of OPENCODE_V2_EVENT_MAPPINGS) {
      if (row.to !== 'drop') continue;
      const froms = Array.isArray(row.from) ? row.from : [row.from];
      for (const f of froms) dropped.add(f);
    }
    const fs = require('node:fs') as typeof import('node:fs');
    const pathMod = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(
      pathMod.join(__dirname, '..', '..', '..', 'node_modules', '@opencode-ai', 'sdk', 'dist', 'v2', 'gen', 'types.gen.d.ts'), 'utf8',
    );
    const line = src.split('\n').find((l) => l.startsWith('export type Event ='))!;
    const members = line.replace(/^export type Event =/, '').replace(/;\s*$/, '').split('|').map((s: string) => s.trim()).filter(Boolean);
    const wire = new Set(members.map((m: string) => {
      const hit = src.match(new RegExp(`export type ${m} = \\{[\\s\\S]*?type: "([^"]+)"`));
      return hit ? hit[1] : `???${m}`;
    }));
    for (const f of dropped) {
      if (f === 'sync' || f === 'message.part.complete') continue;
      expect(wire.has(f)).toBe(true);
    }
  });
});
