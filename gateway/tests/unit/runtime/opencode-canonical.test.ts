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
import {
  OPENCODE_21_EVENT_MAPPINGS,
  OPENCODE_21_EVENT_SOURCE,
  translateOpencode21Event,
} from '../../../src/runtime/opencode-21-events';
import {
  OPENCODE_EVENT_MAPPINGS,
  OPENCODE_EVENT_SOURCE,
  OPENCODE_TRANSFORM_EVENT,
} from '../../../src/runtime/opencode-events';
import { toWireInfo } from '../../../src/runtime/wire-compat';

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

  it('wire egress 把规范 error 投影回原生形状（旧客户端 abort 判定不回归）', () => {
    const [evt]: any[] = applyEventMappings(raw, V1_ENTRY, isCanonical);
    const info: any = toWireInfo(evt.payload.properties.message);

    expect(info.error).toEqual({ name: 'MessageAbortedError', data: { message: 'Interrupted by user' } });
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
