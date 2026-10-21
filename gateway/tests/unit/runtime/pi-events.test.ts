import { translatePiEvent, setPiUnknownRecorder, PI_EVENT_MAPPINGS, PI_EVENT_SOURCE, piTransformEvent } from '../../../src/runtime/pi/pi-events';
import { hasEventDeclarations } from '../../../src/runtime/event-mapper';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

describe('pi 事件翻译覆盖 audit（B1）', () => {
  it('pi 注册面有声明；已知原生类型全部在映射表或 transformEvent，不依赖 canonical 直发', () => {
    const entry = { eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent };
    expect(hasEventDeclarations(entry)).toBe(true);
    // pi 原生名均非 canonical（translatePiEvent 的 isCanonical 为词汇表判定）——不存在直发依赖
    // F1（Plan 2）：agent_end/agent_settled 迁往 transformEvent（stopReason 三分类），不在映射行
    const mapped = new Set(PI_EVENT_MAPPINGS.flatMap((m) => (Array.isArray(m.from) ? m.from : [m.from])));
    for (const t of ['agent_start', 'message_start', 'message_update', 'message_end', 'tool_call', 'tool_result', 'turn_start', 'turn_end']) {
      expect(mapped.has(t)).toBe(true);
    }
  });
});

describe('translatePiEvent', () => {
  it('agent_end maps to turn.completed (v2: not session.updated)', () => {
    const out = translatePiEvent({ type: 'agent_end' }, 'pi_x');
    expect(out?.payload.type).toBe('turn.completed');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('message_update maps to part.updated with delta text', () => {
    const out = translatePiEvent({ type: 'message_update', delta: 'hi' }, 'pi_x');
    expect(out?.payload.type).toBe('part.updated');
    expect(out?.payload.properties.part.text).toBe('hi');
  });

  it('turn_end maps to step-finish part with messageID (bug fix: facet reads messageID)', () => {
    const out = translatePiEvent({ type: 'turn_end' }, 'pi_x');
    expect(out?.payload.type).toBe('part.updated');
    expect(out?.payload.properties.part.type).toBe('step-finish');
    expect(out?.payload.properties.part.messageID).toBe('pi_step_pi_x');
  });

  it('turn_end full chain yields a step facet (BudgetGuard now fires on pi)', () => {
    const mapped = translatePiEvent({ type: 'turn_end' }, 'pi_x');
    const facets = normalizeOpencodeEvent(mapped!);
    expect(facets.step).toEqual({ sessionID: 'pi_x', assistantMessageID: 'pi_step_pi_x', finish: undefined });
  });

  it('unknown event types return null', () => {
    expect(translatePiEvent({ type: 'queue_update' }, 'pi_x')).toBeNull();
  });

  it('N1 退役：tool_call/tool_result（extension 钩子事件）→ drop 无输出（原语改由 tool_execution_* 承载）', () => {
    expect(translatePiEvent({ type: 'tool_call', toolCallId: 'tc1', toolName: 'bash', input: { command: 'ls' } }, 'pi_x')).toBeNull();
    expect(translatePiEvent({ type: 'tool_result', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false }, 'pi_x')).toBeNull();
  });
});

describe('permission events', () => {
  it('should translate permission.asked event', () => {
    const event = {
      payload: {
        type: 'permission.asked',
        properties: {
          sessionID: 'session-1',
          requestId: 'req-1',
          toolName: 'bash',
          args: { command: 'ls' },
          risk: 'medium',
        },
      },
    };

    const result = translatePiEvent(event, 'session-1');

    expect(result!.payload.type).toBe('permission.asked');
    expect(result!.payload.properties.sessionID).toBe('session-1');
    expect(result!.payload.properties.requestId).toBe('req-1');
    expect(result!.payload.properties.toolName).toBe('bash');
  });

  it('should translate permission.replied event', () => {
    const event = {
      payload: {
        type: 'permission.replied',
        properties: {
          sessionID: 'session-1',
          requestId: 'req-1',
          approved: true,
        },
      },
    };

    const result = translatePiEvent(event, 'session-1');

    expect(result!.payload.type).toBe('permission.replied');
    expect(result!.payload.properties.approved).toBe(true);
  });
});

describe('pi unknown native telemetry', () => {
  afterEach(() => setPiUnknownRecorder(undefined));

  it('unmapped native type → recorded and dropped', () => {
    const seen: string[] = [];
    setPiUnknownRecorder((t) => seen.push(t));
    expect(translatePiEvent({ type: 'queue_update' }, 'pi_x')).toBeNull();
    expect(seen).toEqual(['queue_update']);
  });

  it('no recorder installed → still drops, no throw', () => {
    expect(translatePiEvent({ type: 'lifecycle_event' }, 'pi_x')).toBeNull();
  });

  it('mapped types never hit the recorder', () => {
    const seen: string[] = [];
    setPiUnknownRecorder((t) => seen.push(t));
    translatePiEvent({ type: 'agent_end' }, 'pi_x');
    translatePiEvent({ type: 'tool_call', toolCallId: 'tc', toolName: 'bash' }, 'pi_x');
    expect(seen).toEqual([]);
  });

  it('permission transform path never hits the recorder', () => {
    const seen: string[] = [];
    setPiUnknownRecorder((t) => seen.push(t));
    translatePiEvent({ payload: { type: 'permission.asked', properties: { sessionID: 's', requestId: 'r', toolName: 'bash' } } }, 's');
    expect(seen).toEqual([]);
  });
});
describe('pi F1/F8��canonical v3 Plan 2����̬���� + agent_start ��ӳ��', () => {
  it('F1: agent_end ��� assistant ��Ϣ stopReason=error �� turn.failed��errorMessage ͸����', () => {
    const out = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
    ] }, 'pi_x');
    expect(out?.payload.type).toBe('turn.failed');
    expect(String(out?.payload.properties.error)).toContain('boom');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('F1: stopReason=aborted �� turn.aborted', () => {
    const out = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', stopReason: 'aborted' },
    ] }, 'pi_x');
    expect(out?.payload.type).toBe('turn.aborted');
  });

  it('F1: ���� stopReason��stop/undefined���� turn.completed', () => {
    const normal = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', stopReason: 'stop' },
    ] }, 'pi_x');
    expect(normal?.payload.type).toBe('turn.completed');
    const noReason = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ] }, 'pi_x');
    expect(noReason?.payload.type).toBe('turn.completed');
  });

  it('F1: �� messages / �� messages �ֶ� �� turn.completed ��ը��Review Focus 1��', () => {
    expect(translatePiEvent({ type: 'agent_end', messages: [] }, 'pi_x')?.payload.type).toBe('turn.completed');
    expect(translatePiEvent({ type: 'agent_end' }, 'pi_x')?.payload.type).toBe('turn.completed');
  });

  it('F1: agent_settled����������ͬ�����߼�', () => {
    const out = translatePiEvent({ type: 'agent_settled', messages: [
      { role: 'assistant', stopReason: 'error', errorMessage: 'x' },
    ] }, 'pi_x');
    expect(out?.payload.type).toBe('turn.failed');
  });

  it('F8: agent_start �� turn.started�����ٲ� session.updated �տǣ�', () => {
    const out = translatePiEvent({ type: 'agent_start' }, 'pi_x');
    expect(out?.payload.type).toBe('turn.started');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('F1 ȫ����error ��̬�� normalize ���� chatSignal=error��goalDriver onSessionError ·����', () => {
    const mapped = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
    ] }, 'pi_x');
    const facets = normalizeOpencodeEvent(mapped!);
    expect(facets.chatSignal).toBe('error');
  });
});

describe('pi N1/N2��live ������ + ��ɫ�޸���', () => {
  it('N1: tool_execution_start �� tool.call��live �����¼���assembler �˵��� running part��', () => {
    const out = translatePiEvent({ type: 'tool_execution_start', toolCallId: 'te1', toolName: 'bash', args: { command: 'ls' } }, 'pi_x');
    expect(out?.payload.type).toBe('tool.call');
    expect(out?.payload.properties).toMatchObject({ callID: 'te1', tool: 'bash', input: { command: 'ls' }, sessionID: 'pi_x' });
  });

  it('N1: tool_execution_update �� tool.delta��kind output��assembler ������ը��', () => {
    const out = translatePiEvent({ type: 'tool_execution_update', toolCallId: 'te1', toolName: 'bash', args: {}, partialResult: 'half' }, 'pi_x');
    expect(out?.payload.type).toBe('tool.delta');
    expect(out?.payload.properties).toMatchObject({ callID: 'te1', kind: 'output' });
  });

  it('N1: tool_execution_end �� tool.result��isError ���ݣ�', () => {
    const ok = translatePiEvent({ type: 'tool_execution_end', toolCallId: 'te1', toolName: 'bash', result: 'done', isError: false }, 'pi_x');
    expect(ok?.payload.type).toBe('tool.result');
    expect(ok?.payload.properties).toMatchObject({ callID: 'te1', output: 'done', isError: false });
    const err = translatePiEvent({ type: 'tool_execution_end', toolCallId: 'te2', toolName: 'bash', result: 'boom', isError: true }, 'pi_x');
    expect(err?.payload.properties.isError).toBe(true);
  });

  it('N1: �� tool_call/tool_result �����ۡ���extension �����¼���ʽ drop���������', () => {
    expect(translatePiEvent({ type: 'tool_call', toolCallId: 'x', toolName: 'bash', input: {} }, 'pi_x')).toBeNull();
    expect(translatePiEvent({ type: 'tool_result', toolCallId: 'x', toolName: 'bash', content: [], isError: false }, 'pi_x')).toBeNull();
  });

  it('N2: message_end ��ɫ�� $.message.role ȡֵ��user ��Ϣ������� assistant��', () => {
    const user = translatePiEvent({ type: 'message_end', message: { role: 'user', content: 'hi', timestamp: 1 } }, 'pi_x');
    expect(user?.payload.type).toBe('message.updated');
    expect(user?.payload.properties.message.role).toBe('user');
    const assistant = translatePiEvent({ type: 'message_end', message: { role: 'assistant', content: [], timestamp: 2, stopReason: 'stop' } }, 'pi_x');
    expect(assistant?.payload.properties.message.role).toBe('assistant');
    expect(assistant?.payload.properties.message.time).toMatchObject({ completed: 2 });
    expect(assistant?.payload.properties.message.finish).toBe('stop');
  });
});
