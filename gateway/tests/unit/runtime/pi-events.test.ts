import { translatePiEvent, setPiUnknownRecorder } from '../../../src/runtime/pi/pi-events';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

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

  it('tool_call → tool.call 原语（callID/tool/input 抽取 + sessionID 注入）', () => {
    const out = translatePiEvent({ type: 'tool_call', toolCallId: 'tc1', toolName: 'bash', input: { command: 'ls' } }, 'pi_x');
    expect(out).toEqual({
      payload: { type: 'tool.call', properties: { callID: 'tc1', tool: 'bash', input: { command: 'ls' }, sessionID: 'pi_x' } },
      sessionID: 'pi_x',
      directory: undefined,
    });
  });

  it('tool_result → tool.result 原语（content 数组原样过，assembler coerce）', () => {
    const content = [{ type: 'text', text: 'ok' }];
    const out = translatePiEvent({ type: 'tool_result', toolCallId: 'tc1', toolName: 'bash', input: {}, content, isError: false }, 'pi_x');
    expect(out).toEqual({
      payload: { type: 'tool.result', properties: { callID: 'tc1', tool: 'bash', isError: false, output: content, sessionID: 'pi_x' } },
      sessionID: 'pi_x',
      directory: undefined,
    });
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