/**
 * @2.1 方言表契约：opencode 2.1.0 顶层 type/data 事件 → canonical 事件。
 * 用真实抓包载荷（4105 serve）钉扎字段路径；tool 输入跨事件补齐。
 */
import { applyEventMappings, validateEventMappings } from '../../../src/runtime/event-mapper';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';
import {
  OPENCODE_21_EVENT_MAPPINGS,
  OPENCODE_21_EVENT_SOURCE,
  translateOpencode21Event,
} from '../../../src/runtime/opencode-21-events';

const canonical = new Set(MAFW_RUNTIME_EVENT_NAMES);
const entry = {
  eventSource: OPENCODE_21_EVENT_SOURCE,
  eventMappings: OPENCODE_21_EVENT_MAPPINGS,
  transformEvent: translateOpencode21Event,
};

function apply(raw: any): any[] {
  return applyEventMappings(raw, entry, (t) => canonical.has(t));
}

const evt = (type: string, data: any, extra: any = {}) => ({
  id: 'evt_1', created: 1000, type, data, location: { directory: 'C:/work' }, ...extra,
});

describe('@2.1 方言表校验', () => {
  test('无加载期问题（to 均为 canonical / 路径合法）', () => {
    expect(validateEventMappings(entry, canonical)).toEqual([]);
  });
});

describe('@2.1 生命周期与回合终态', () => {
  test('session.execution.started/succeeded/failed → turn 三元组', () => {
    expect(apply(evt('session.execution.started', { sessionID: 's1' }))[0].payload)
      .toMatchObject({ type: 'turn.started', properties: { sessionID: 's1' } });
    expect(apply(evt('session.execution.succeeded', { sessionID: 's1' }))[0].payload)
      .toMatchObject({ type: 'turn.completed', properties: { sessionID: 's1' } });
    const failed = apply(evt('session.execution.failed', {
      sessionID: 's1', error: { type: 'provider.auth', message: 'Consumer is forbidden.' },
    }))[0].payload;
    expect(failed.type).toBe('turn.failed');
    expect(failed.properties.error).toBe('Consumer is forbidden.');
  });

  test('session.usage.updated → usage.updated（cost/tokens 透传）', () => {
    const out = apply(evt('session.usage.updated', {
      sessionID: 's1', cost: 0.0015, tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } },
    }))[0].payload;
    expect(out.type).toBe('usage.updated');
    expect(out.properties).toMatchObject({ sessionID: 's1', cost: 0.0015, tokens: { input: 10, output: 5 } });
  });

  test('session.created / deleted → canonical（data 透传）', () => {
    expect(apply(evt('session.created', { sessionID: 's1', slug: 'quiet' }))[0].payload)
      .toMatchObject({ type: 'session.created', properties: { sessionID: 's1', slug: 'quiet' } });
    expect(apply(evt('session.deleted', { sessionID: 's1' }))[0].payload.type).toBe('session.deleted');
  });

  test('session.renamed → session.updated {info:{id,title}}（desktop 生命周期契约）', () => {
    const out = apply(evt('session.renamed', { sessionID: 's1', title: '新的标题' }))[0].payload;
    expect(out).toMatchObject({ type: 'session.updated', properties: { info: { id: 's1', title: '新的标题' } } });
  });

  test('session.agent.selected / model.selected → session.updated info', () => {
    const agent = apply(evt('session.agent.selected', { sessionID: 's1', agent: 'plan' }))[0].payload;
    expect(agent.properties.info).toMatchObject({ id: 's1', agent: 'plan' });
    const model = apply(evt('session.model.selected', { sessionID: 's1', model: { id: 'm1', providerID: 'p1' } }))[0].payload;
    expect(model.properties.info.model).toEqual({ providerID: 'p1', modelID: 'm1' });
  });
});

describe('@2.1 审批（v2 形状 → canonical permission.asked）', () => {
  test('id/action/resources 映射为 requestId/permission/patterns', () => {
    const out = apply(evt('permission.v2.asked', {
      id: 'per_1', sessionID: 's1', action: 'bash', resources: ['echo hi'], metadata: { impact: 'shell' },
    }))[0].payload;
    expect(out.type).toBe('permission.asked');
    expect(out.properties).toMatchObject({
      id: 'per_1', sessionID: 's1', requestId: 'per_1', permission: 'bash', patterns: ['echo hi'],
    });
  });

  test('permission.v2.replied → permission.replied', () => {
    const out = apply(evt('permission.v2.replied', { sessionID: 's1', requestID: 'per_1', decision: 'once' }))[0].payload;
    expect(out.type).toBe('permission.replied');
    expect(out.properties.requestId).toBe('per_1');
  });
});

describe('@2.1 流式文本/推理', () => {
  test('text started/delta/ended：part id 与历史合成规则一致', () => {
    const started = apply(evt('session.text.started', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0 }))[0].payload;
    expect(started.type).toBe('part.updated');
    expect(started.properties.part).toMatchObject({ id: 'm1-p0', messageID: 'm1', type: 'text', text: '' });

    const delta = apply(evt('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'hello' }))[0].payload;
    expect(delta).toMatchObject({ type: 'part.delta', properties: { messageID: 'm1', partID: 'm1-p0', field: 'text', delta: 'hello' } });

    const ended = apply(evt('session.text.ended', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, text: 'hello world' }))[0].payload;
    expect(ended.properties.part).toMatchObject({ id: 'm1-p0', type: 'text', text: 'hello world' });
  });

  test('reasoning delta 映射 field=reasoning（desktop 已支持累积）', () => {
    const delta = apply(evt('session.reasoning.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 1, delta: 'think' }))[0].payload;
    expect(delta).toMatchObject({ type: 'part.delta', properties: { partID: 'm1-p1', field: 'reasoning', delta: 'think' } });
  });
});

describe('@2.1 step 与工具卡', () => {
  test('step.started → message.updated（assistant info 带 agent/model）', () => {
    const out = apply(evt('session.step.started', {
      sessionID: 's1', agent: 'plan', model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go', variant: 'default' },
      assistantMessageID: 'm1', started: 2000,
    }))[0].payload;
    expect(out.type).toBe('message.updated');
    expect(out.properties.info).toMatchObject({
      id: 'm1', sessionID: 's1', role: 'assistant', agent: 'plan',
      model: { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash', variant: 'default' },
      time: { created: 2000 },
    });
  });

  test('step.ended → part.updated step-finish（BudgetGuard step 切面入口）', () => {
    const out = apply(evt('session.step.ended', {
      sessionID: 's1', assistantMessageID: 'm1', finish: 'tool-calls', cost: 0.001, tokens: { input: 9, output: 4 },
    }))[0].payload;
    expect(out.type).toBe('part.updated');
    expect(out.properties.part).toMatchObject({ messageID: 'm1', type: 'step-finish', reason: 'tool-calls' });
  });

  test('tool input/called/success：快照补齐 input 与 output（call id 为 part id）', () => {
    apply(evt('session.tool.input.started', { sessionID: 's1', assistantMessageID: 'm1', id: 'call_1', name: 'shell' }));
    apply(evt('session.tool.input.ended', { sessionID: 's1', assistantMessageID: 'm1', id: 'call_1', text: '{"command":"echo hi"}' }));
    const called = apply(evt('session.tool.called', { sessionID: 's1', assistantMessageID: 'm1', id: 'call_1', input: { command: 'echo hi' } }))[0].payload;
    expect(called.properties.part).toMatchObject({
      id: 'call_1', messageID: 'm1', type: 'tool', tool: 'shell', callID: 'call_1',
      state: { status: 'running', input: { command: 'echo hi' } },
    });
    const success = apply(evt('session.tool.success', {
      sessionID: 's1', assistantMessageID: 'm1', id: 'call_1',
      content: [{ type: 'text', text: 'hi\n' }], metadata: { exit: 0 },
    }))[0].payload;
    expect(success.properties.part.state).toMatchObject({
      status: 'completed', input: { command: 'echo hi' }, output: 'hi\n', metadata: { exit: 0 },
    });
    expect(success.properties.part.tool).toBe('shell');
  });

  test('tool.failed → state.error 归一为字符串（2.1 是 {type,message} 对象）', () => {
    const out = apply(evt('session.tool.failed', {
      sessionID: 's1', assistantMessageID: 'm1', id: 'call_9',
      error: { type: 'tool.execution', message: 'Could not find oldString' },
    }))[0].payload;
    expect(out.properties.part.state).toMatchObject({
      status: 'error',
      error: 'Could not find oldString',
      output: 'Could not find oldString',
    });
    expect(typeof out.properties.part.state.error).toBe('string');
  });
});

describe('@2.1 问询与 todo', () => {
  test('question.v2.asked/replied/rejected → question.*（载荷透传）', () => {
    const asked = apply(evt('question.v2.asked', {
      id: 'q1', sessionID: 's1',
      questions: [{ question: 'Pick', options: [{ label: 'a' }, { label: 'b' }] }],
    }))[0].payload;
    expect(asked.type).toBe('question.asked');
    expect(asked.properties.questions).toHaveLength(1);
    expect(apply(evt('question.v2.replied', { sessionID: 's1', id: 'q1' }))[0].payload.type).toBe('question.replied');
    expect(apply(evt('question.v2.rejected', { sessionID: 's1', id: 'q1' }))[0].payload.type).toBe('question.rejected');
  });

  test('todo.updated → plan.updated（桌面任务面板）', () => {
    const out = apply(evt('todo.updated', { sessionID: 's1', todos: [{ content: 'x', status: 'pending' }] }))[0].payload;
    expect(out.type).toBe('plan.updated');
    expect(out.properties.todos).toHaveLength(1);
  });

  test('question.v2.asked 带 form 载荷 → typed questions + mode=url', () => {
    const out = apply(evt('question.v2.asked', {
      sessionID: 's1',
      form: {
        id: 'f1', sessionID: 's1', title: 'T',
        fields: [
          { key: 'name', type: 'string', title: 'Name', required: true },
          { key: 'link', type: 'external', title: 'Link', url: 'https://x' },
        ],
      },
    }))[0].payload;
    expect(out.type).toBe('question.asked');
    expect(out.properties.questions).toHaveLength(2);
    expect(out.properties.questions[0]).toMatchObject({ id: 'name', type: 'string', required: true });
    expect(out.properties.mode).toBe('url');
  });

  test('question.v2.asked 旧 questions[] 原样透传', () => {
    const out = apply(evt('question.v2.asked', {
      sessionID: 's1', questions: [{ question: 'Q', options: [{ label: 'A' }] }],
    }))[0].payload;
    expect(out.type).toBe('question.asked');
    expect(out.properties.questions).toHaveLength(1);
  });
});

describe('@2.1 抑制与未知事件', () => {  test('遥测/无消费者事件 → drop（suppressed）', () => {
    const suppressed: string[] = [];
    const out = applyEventMappings(evt('server.connected', {}), entry, (t) => canonical.has(t), {
      onSuppressed: (t) => suppressed.push(t),
    });
    expect(out).toEqual([]);
    expect(suppressed).toEqual(['server.connected']);
    expect(apply(evt('session.step.streamed', { sessionID: 's1' }))).toEqual([]);
  });

  test('未知类型原样透传（unknownEvents 漂移可见）', () => {
    const raw = evt('session.future.thing', { sessionID: 's1' });
    expect(apply(raw)[0]).toBe(raw);
  });
});

describe('@2.1 终态 stopReason 与补漏事件', () => {
  test('succeeded 带 finish=length → stopReason=max_tokens', () => {
    const out = apply(evt('session.execution.succeeded', { sessionID: 's-len', finish: 'length' }))[0].payload;
    expect(out).toMatchObject({
      type: 'turn.completed',
      properties: { sessionID: 's-len', stopReason: 'max_tokens', finish: 'length' },
    });
  });

  test('先 step.ended(finish=stop) 再 succeeded（无 finish）→ end_turn', () => {
    apply(evt('session.step.ended', { sessionID: 's-stop', assistantMessageID: 'm1', finish: 'stop' }));
    const out = apply(evt('session.execution.succeeded', { sessionID: 's-stop' }))[0].payload;
    expect(out.properties.stopReason).toBe('end_turn');
  });

  test('succeeded 无 finish 且无 step → unknown', () => {
    const out = apply(evt('session.execution.succeeded', { sessionID: 's-unknown' }))[0].payload;
    expect(out.properties.stopReason).toBe('unknown');
  });

  test('failed 带 errorCode；interrupted → turn.aborted cancelled', () => {
    const failed = apply(evt('session.execution.failed', {
      sessionID: 's-fail', error: { type: 'provider.auth', message: 'forbidden' },
    }))[0].payload;
    expect(failed).toMatchObject({
      type: 'turn.failed',
      properties: { error: 'forbidden', errorCode: 'provider.auth', stopReason: 'error' },
    });
    const aborted = apply(evt('session.execution.interrupted', { sessionID: 's-int' }))[0].payload;
    expect(aborted).toMatchObject({
      type: 'turn.aborted',
      properties: { sessionID: 's-int', stopReason: 'cancelled' },
    });
  });

  test('session.diff → canonical（diff 与 files 两种形状）', () => {
    const a = apply(evt('session.diff', { sessionID: 's1', diff: [{ file: 'a.ts' }] }))[0].payload;
    expect(a).toMatchObject({ type: 'session.diff', properties: { sessionID: 's1', diff: [{ file: 'a.ts' }] } });
    const b = apply(evt('session.diff', { sessionID: 's2', files: [{ file: 'b.ts' }] }))[0].payload;
    expect(b.properties.diff).toEqual([{ file: 'b.ts' }]);
  });

  test('compaction.failed / retry.scheduled / inbox → canonical', () => {
    const comp = apply(evt('session.compaction.failed', {
      sessionID: 's1', error: { message: 'budget' }, reason: 'auto',
    }))[0].payload;
    expect(comp).toMatchObject({
      type: 'session.compacted',
      properties: { status: 'failed', error: 'budget', reason: 'auto' },
    });

    const retry = apply(evt('session.retry.scheduled', {
      sessionID: 's1', assistantMessageID: 'm1', attempt: 2, at: 123, error: { message: 'rate limit' },
    }))[0].payload;
    expect(retry).toMatchObject({
      type: 'message.updated',
      properties: { info: { id: 'm1', sessionID: 's1', retry: { attempt: 2, at: 123 } } },
    });

    const queue = apply(evt('session.inbox.enqueued', {
      sessionID: 's1', item: { id: 'q1', text: 'later' },
    }))[0].payload;
    expect(queue).toMatchObject({
      type: 'queue.updated',
      properties: { sessionID: 's1', action: 'enqueued', item: { id: 'q1' } },
    });
  });
});
