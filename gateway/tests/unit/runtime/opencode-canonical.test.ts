/**
 * opencode 原生消息 → MAFW 规范字段的**生产者**契约。
 *
 * 背景（Task 9 review Important 1）：session-ui 只读规范形（`message.model` /
 * `stopReason` / `error:{kind,message}` / tool `state.output`），而 opencode
 * 历史与 live 事件此前只搬运原生字段（`modelID+providerID` / `finish` /
 * `error:{name,data}` / `state.content[]`）——规范字段在真实链路上恒为空，
 * 渲染层静默退化。本文件钉死两条链路都必须补出规范字段。
 */
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { normalizeOpencodeHistory } from '../../../src/runtime/opencode-history';
import { errorKindOf } from '../../../src/runtime/opencode-canonical';
import {
  OPENCODE_21_EVENT_MAPPINGS,
  OPENCODE_21_EVENT_SOURCE,
  translateOpencode21Event,
} from '../../../src/runtime/opencode-21-events';
import { OPENCODE_EVENT_MAPPINGS, OPENCODE_EVENT_SOURCE, OPENCODE_TRANSFORM_EVENT } from '../../../src/runtime/opencode-events';

const V1_ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};

const ENTRY_21 = {
  eventSource: OPENCODE_21_EVENT_SOURCE,
  eventMappings: OPENCODE_21_EVENT_MAPPINGS,
  transformEvent: translateOpencode21Event,
};

const isCanonical = (t: string) => !!EVENT_FLOW_MATRIX[t];

// ---------------------------------------------------------------- history

const abortedAssistantWire = {
  info: {
    id: 'ma_1', sessionID: 'ses_1', role: 'assistant',
    time: { created: 1, completed: 2 },
    finish: 'interrupted', modelID: 'glm-5.3', providerID: 'gateway', variant: 'max',
    error: { name: 'MessageAbortedError', data: { message: 'Interrupted by user' } },
  },
  parts: [
    {
      id: 'p_tool', sessionID: 'ses_1', messageID: 'ma_1', type: 'tool', callID: 'c1', tool: 'bash',
      // opencode 2.1 历史工具结果在 state.content[]，没有 state.output
      state: {
        status: 'completed', input: { command: 'ls' },
        content: [{ type: 'text', text: 'a.txt' }, { type: 'text', text: 'b.txt' }],
        title: 'bash', metadata: {}, time: { start: 1, end: 2 },
      },
    },
  ],
};

const providerErrorWire = {
  info: {
    id: 'ma_2', sessionID: 'ses_1', role: 'assistant',
    time: { created: 3, completed: 4 },
    modelID: 'glm-5.3', providerID: 'gateway',
    error: { name: 'ApiError', data: { message: '429 Too Many Requests' } },
  },
  parts: [],
};

describe('error kind precedence（provider-cancel vs user abort）', () => {
  it('provider 取消/中断文案不被判成用户中止（abort 需要显式类名）', () => {
    expect(errorKindOf({ name: 'ProviderError', message: 'request cancelled by provider' })).toBe('provider');
    expect(errorKindOf({ name: 'GenericError', message: 'request cancelled by provider' })).toBe('provider');
    expect(errorKindOf({ name: 'GenericError', message: 'Provider cancelled request after 403' })).toBe('provider');
    // 显式中止类名优先：文案提到 provider 也仍是用户中止
    expect(errorKindOf({ name: 'MessageAbortedError', message: 'interrupted by provider timeout' })).toBe('abort');
    // 错误对象丢了类名时的文案级 cancel 兜底（不落 unknown）
    expect(errorKindOf({ name: 'GenericError', message: 'Operation cancelled' })).toBe('abort');
    expect(errorKindOf({ message: 'stopped by user' })).toBe('abort');
  });
});

describe('history：assistant 规范字段生产者', () => {
  it('abort 回合：model / stopReason / error{kind:abort,message} / tool output 全部补齐', () => {
    const [flat]: any = normalizeOpencodeHistory([abortedAssistantWire]);

    expect(flat.model).toEqual({ providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' });
    expect(flat.stopReason).toBe('cancelled');
    expect(flat.error).toEqual({ kind: 'abort', message: 'Interrupted by user' });
    expect(flat.content[0].state.output).toBe('a.txt\nb.txt');
  });

  it('provider 错误：保留原始错误文本，kind 中性化、stopReason=error', () => {
    const [flat]: any = normalizeOpencodeHistory([providerErrorWire]);

    expect(flat.error).toEqual({ kind: 'rate-limit', message: '429 Too Many Requests' });
    expect(flat.stopReason).toBe('error');
    expect(flat.model).toEqual({ providerID: 'gateway', modelID: 'glm-5.3' });
  });

  it('原生字段仍透传（兼容 egress），规范 error 不暴露原生类名', () => {
    const [flat]: any = normalizeOpencodeHistory([providerErrorWire]);

    // 兼容窗口：wire egress 仍需要原生字段（Task 15 删除）
    expect(flat.modelID).toBe('glm-5.3');
    expect(flat.providerID).toBe('gateway');
    // flat 规范字段不得携带 runtime 原生错误判别
    expect(flat.error).not.toHaveProperty('name');
    expect(flat.error).not.toHaveProperty('data');
  });

  it('finish 走 stopReasonOf；已有 output 的工具部件保持引用（零拷贝）', () => {
    const tool = {
      id: 'p2', type: 'tool', callID: 'c2', tool: 'read',
      state: { status: 'completed', input: {}, output: 'kept' },
    };
    const wire = { info: { id: 'ma_3', role: 'assistant', finish: 'length' }, parts: [tool] };
    const [flat]: any = normalizeOpencodeHistory([wire]);

    expect(flat.stopReason).toBe('max_tokens');
    expect(flat.content[0]).toBe(tool);
  });

  it('user 消息不注入 assistant 字段（model 已是对象，保持零换名）', () => {
    const [flat]: any = normalizeOpencodeHistory([
      { info: { id: 'mu_1', role: 'user', model: { providerID: 'p', modelID: 'm' } }, parts: [] },
    ]);
    expect(flat.model).toEqual({ providerID: 'p', modelID: 'm' });
    expect(flat).not.toHaveProperty('stopReason');
    expect(flat).not.toHaveProperty('error');
  });

  it('重复归一是幂等的（wrap/facade 二次归一不降级 error.kind）', () => {
    const once: any = normalizeOpencodeHistory([abortedAssistantWire])[0];
    const twice: any = normalizeOpencodeHistory([once])[0];

    expect(twice.error).toEqual({ kind: 'abort', message: 'Interrupted by user' });
    expect(twice.stopReason).toBe('cancelled');
    expect(twice.model).toEqual({ providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' });
    // 零拷贝不变量：字段值已等价 → 原对象引用（不重复分配）
    expect(twice).toBe(once);
  });

  it('只有错误类名（无 data.message）时也产出非空规范 message', () => {
    const [flat]: any = normalizeOpencodeHistory([
      { info: { id: 'ma_4', role: 'assistant', error: { name: 'MessageAbortedError' } }, parts: [] },
    ]);
    expect(flat.error).toEqual({ kind: 'abort', message: 'MessageAbortedError' });
    expect(flat.error.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- live

describe('live：opencode @v1 message.updated 规范字段', () => {
  const raw = {
    directory: '/p',
    payload: {
      type: 'message.updated',
      properties: {
        sessionID: 'ses_1',
        info: {
          id: 'ma_1', sessionID: 'ses_1', role: 'assistant',
          finish: 'interrupted', modelID: 'glm-5.3', providerID: 'gateway',
          error: { name: 'MessageAbortedError', data: { message: 'Interrupted by user' } },
        },
      },
    },
  };

  it('消息载荷产出 model / stopReason / error{kind,message}', () => {
    const [evt]: any[] = applyEventMappings(raw, V1_ENTRY, isCanonical);
    const message = evt.payload.properties.message;

    expect(evt.payload.type).toBe('message.updated');
    expect(message.model).toEqual({ providerID: 'gateway', modelID: 'glm-5.3' });
    expect(message.stopReason).toBe('cancelled');
    expect(message.error).toEqual({ kind: 'abort', message: 'Interrupted by user' });
    // 兼容窗口：原生字段仍在（旧 wire 消费者）
    expect(message.modelID).toBe('glm-5.3');
  });

  it('wire egress 已删除：规范 error 直接留在 canonical message', () => {
    const [evt]: any[] = applyEventMappings(raw, V1_ENTRY, isCanonical);
    const message: any = evt.payload.properties.message;

    expect(message.error).toEqual({ kind: 'abort', message: 'Interrupted by user' });
    expect(message.error.name).toBeUndefined();
  });
});

describe('live：opencode 2.1 方言规范字段', () => {
  it('step.started 产出 model（含 variant）', () => {
    const [evt]: any[] = applyEventMappings(
      {
        type: 'session.step.started',
        data: {
          sessionID: 'ses_1', assistantMessageID: 'ma_1',
          model: { id: 'glm-5.3', providerID: 'gateway', variant: 'max' },
        },
        created: 1,
      },
      ENTRY_21,
      isCanonical,
    );

    expect(evt.payload.properties.message.model).toEqual({
      providerID: 'gateway', modelID: 'glm-5.3', variant: 'max',
    });
  });

  it('tool.success 产出 state.output（原生 content[] 归一）', () => {
    const [evt]: any[] = applyEventMappings(
      {
        type: 'session.tool.success',
        data: {
          sessionID: 'ses_1', assistantMessageID: 'ma_1', id: 'c1',
          content: [{ type: 'text', text: 'out-1' }, { type: 'text', text: 'out-2' }],
        },
        created: 5,
      },
      ENTRY_21,
      isCanonical,
    );

    expect(evt.payload.properties.part.state.status).toBe('completed');
    expect(evt.payload.properties.part.state.output).toBe('out-1out-2');
  });
});

/**
 * 2.1 的回合终态原本只有 turn 三元组（turn.completed/failed/aborted），
 * message 级规范字段（`stopReason` / `error{kind,message}`）没有生产者，
 * session-ui 的中止分隔条与非正常停止提示在 live 下永不出现。
 *
 * 现在：终态额外在**已存在的 assistant 锚点**上补一帧 `message.updated`
 * （id 来自本次 turn 的 step/tool/text 事件；无锚点则不伪造消息，只保留
 * turn 语义）。桌面按 id 合并，不产生重复气泡。
 */
describe('live：2.1 执行终态补 message 级规范字段', () => {
  function terminal(type: string, data: Record<string, unknown>) {
    return applyEventMappings({ type, data, created: 9 }, ENTRY_21, isCanonical) as any[];
  }

  function startStep(sessionID: string, assistantMessageID: string) {
    terminal('session.step.started', { sessionID, assistantMessageID, started: 1 });
  }

  it('succeeded：锚点消息补 stopReason（finish→canonical），无 error', () => {
    const sid = 's-live-ok';
    startStep(sid, 'ma_ok');
    const events = terminal('session.execution.succeeded', { sessionID: sid, finish: 'length' });

    expect(events.map((e) => e.payload.type)).toEqual(['turn.completed', 'message.updated']);
    const message = events[1].payload.properties.message;
    expect(message).toMatchObject({ id: 'ma_ok', sessionID: sid, role: 'assistant', stopReason: 'max_tokens' });
    expect(message).not.toHaveProperty('error');
    // turn 语义保持不变
    expect(events[0].payload.properties).toMatchObject({ sessionID: sid, stopReason: 'max_tokens', finish: 'length' });
  });

  it('failed：锚点消息补 stopReason=error 与 error{kind,message}（保留 provider 文本）', () => {
    const sid = 's-live-fail';
    startStep(sid, 'ma_fail');
    const events = terminal('session.execution.failed', {
      sessionID: sid,
      error: { type: 'provider.auth', message: 'Consumer is forbidden.' },
    });

    expect(events.map((e) => e.payload.type)).toEqual(['turn.failed', 'message.updated']);
    expect(events[1].payload.properties.message).toMatchObject({
      id: 'ma_fail', role: 'assistant', stopReason: 'error',
      error: { kind: 'provider', message: 'Consumer is forbidden.' },
    });
    // turn 载荷零回归
    expect(events[0].payload.properties).toMatchObject({
      error: 'Consumer is forbidden.', errorCode: 'provider.auth', stopReason: 'error',
    });
  });

  it('interrupted：锚点消息补 stopReason=cancelled 与 error{kind:abort}', () => {
    const sid = 's-live-abort';
    startStep(sid, 'ma_abort');
    const events = terminal('session.execution.interrupted', { sessionID: sid });

    expect(events.map((e) => e.payload.type)).toEqual(['turn.aborted', 'message.updated']);
    expect(events[1].payload.properties.message).toMatchObject({
      id: 'ma_abort', role: 'assistant', stopReason: 'cancelled',
      error: { kind: 'abort', message: 'Interrupted' },
    });

    // SSE egress：canonical message 原样广播（Task 15 删除 wire 投影）
    expect(events[1].payload.properties.message).toMatchObject({
      id: 'ma_abort', role: 'assistant', stopReason: 'cancelled',
      error: { kind: 'abort', message: 'Interrupted' },
    });
    expect(events[1].payload.properties.info).toBeUndefined();
  });

  it('无锚点（本回合没有任何 step/tool/text 事件）→ 不伪造消息，只保留 turn 事件', () => {
    const events = terminal('session.execution.interrupted', { sessionID: 's-live-no-anchor' });
    expect(events.map((e) => e.payload.type)).toEqual(['turn.aborted']);
  });

  it('终态消费锚点：同会话后续无 step 的终态不挂到上一回合的旧锚点', () => {
    startStep('s-live-leak', 'ma_old');
    terminal('session.execution.interrupted', { sessionID: 's-live-leak' });
    const again = terminal('session.execution.interrupted', { sessionID: 's-live-leak' });

    expect(again.map((e) => e.payload.type)).toEqual(['turn.aborted']);
  });

  it('interrupted 清理 lastFinish（finish 不跨回合冒充）', () => {
    terminal('session.step.ended', { sessionID: 's-live-finish', assistantMessageID: 'ma_f', finish: 'length' });
    terminal('session.execution.interrupted', { sessionID: 's-live-finish' });

    const [turn] = terminal('session.execution.succeeded', { sessionID: 's-live-finish' });
    expect(turn.payload.properties.stopReason).toBe('unknown');
  });

  it('history 与 live 的规范字段一致（中止 / 截断）', () => {
    const [historyAbort]: any = normalizeOpencodeHistory([abortedAssistantWire]);
    startStep('s-parity-abort', 'ma_parity');
    const liveAbort = terminal('session.execution.interrupted', { sessionID: 's-parity-abort' })[1].payload.properties
      .message;

    expect(liveAbort.stopReason).toBe(historyAbort.stopReason); // cancelled
    expect(liveAbort.error.kind).toBe(historyAbort.error.kind); // abort
    expect(typeof liveAbort.error.message).toBe('string');
    expect(liveAbort.error.message.length).toBeGreaterThan(0);

    const [historyLength]: any = normalizeOpencodeHistory([
      { info: { id: 'ma_h', role: 'assistant', finish: 'length' }, parts: [] },
    ]);
    startStep('s-parity-len', 'ma_len');
    const liveLen = terminal('session.execution.succeeded', { sessionID: 's-parity-len', finish: 'length' })[1].payload
      .properties.message;

    expect(liveLen.stopReason).toBe(historyLength.stopReason); // max_tokens
    expect(historyLength.stopReason).toBe('max_tokens');
  });
});

