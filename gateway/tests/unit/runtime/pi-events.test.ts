import { translatePiEvent, setPiUnknownRecorder, PI_EVENT_MAPPINGS, PI_EVENT_SOURCE, piTransformEvent } from '../../../src/runtime/pi/pi-events';
import { hasEventDeclarations } from '../../../src/runtime/event-mapper';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

describe('pi äº‹ä»¶ç¿»è¯‘è¦†ç›– auditï¼ˆB1ï¼‰', () => {
  it('pi æ³¨å†Œé¢æœ‰å£°æ˜Žï¼›å·²çŸ¥åŽŸç”Ÿç±»åž‹å…¨éƒ¨åœ¨æ˜ å°„è¡¨æˆ– transformEventï¼Œä¸ä¾èµ– canonical ç›´å‘', () => {
    const entry = { eventSource: PI_EVENT_SOURCE, eventMappings: PI_EVENT_MAPPINGS, transformEvent: piTransformEvent };
    expect(hasEventDeclarations(entry)).toBe(true);
    // pi åŽŸç”Ÿåå‡éž canonicalï¼ˆtranslatePiEvent çš„ isCanonical ä¸ºè¯æ±‡è¡¨åˆ¤å®šï¼‰â€”â€”ä¸å­˜åœ¨ç›´å‘ä¾èµ–
    // F1ï¼ˆPlan 2ï¼‰ï¼šagent_end/agent_settled è¿å¾€ transformEventï¼ˆstopReason ä¸‰åˆ†ç±»ï¼‰ï¼Œä¸åœ¨æ˜ å°„è¡Œ
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

  it('tool_call â†’ tool.call åŽŸè¯­ï¼ˆcallID/tool/input æŠ½å– + sessionID æ³¨å…¥ï¼‰', () => {
    const out = translatePiEvent({ type: 'tool_call', toolCallId: 'tc1', toolName: 'bash', input: { command: 'ls' } }, 'pi_x');
    expect(out).toEqual({
      payload: { type: 'tool.call', properties: { callID: 'tc1', tool: 'bash', input: { command: 'ls' }, sessionID: 'pi_x' } },
      sessionID: 'pi_x',
      directory: undefined,
    });
  });

  it('tool_result â†’ tool.result åŽŸè¯­ï¼ˆcontent æ•°ç»„åŽŸæ ·è¿‡ï¼Œassembler coerceï¼‰', () => {
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

  it('unmapped native type â†’ recorded and dropped', () => {
    const seen: string[] = [];
    setPiUnknownRecorder((t) => seen.push(t));
    expect(translatePiEvent({ type: 'queue_update' }, 'pi_x')).toBeNull();
    expect(seen).toEqual(['queue_update']);
  });

  it('no recorder installed â†’ still drops, no throw', () => {
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
describe('pi F1/F8£¨canonical v3 Plan 2£ºÖÕÌ¬·ÖÀà + agent_start ÖØÓ³£©', () => {
  it('F1: agent_end ×îºó assistant ÏûÏ¢ stopReason=error ¡ú turn.failed£¨errorMessage Í¸´«£©', () => {
    const out = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
    ] }, 'pi_x');
    expect(out?.payload.type).toBe('turn.failed');
    expect(String(out?.payload.properties.error)).toContain('boom');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('F1: stopReason=aborted ¡ú turn.aborted', () => {
    const out = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', stopReason: 'aborted' },
    ] }, 'pi_x');
    expect(out?.payload.type).toBe('turn.aborted');
  });

  it('F1: Õý³£ stopReason£¨stop/undefined£©¡ú turn.completed', () => {
    const normal = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', stopReason: 'stop' },
    ] }, 'pi_x');
    expect(normal?.payload.type).toBe('turn.completed');
    const noReason = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ] }, 'pi_x');
    expect(noReason?.payload.type).toBe('turn.completed');
  });

  it('F1: ¿Õ messages / ÎÞ messages ×Ö¶Î ¡ú turn.completed ²»Õ¨£¨Review Focus 1£©', () => {
    expect(translatePiEvent({ type: 'agent_end', messages: [] }, 'pi_x')?.payload.type).toBe('turn.completed');
    expect(translatePiEvent({ type: 'agent_end' }, 'pi_x')?.payload.type).toBe('turn.completed');
  });

  it('F1: agent_settled£¨·ÀÓùÃû£©Í¬·ÖÀàÂß¼­', () => {
    const out = translatePiEvent({ type: 'agent_settled', messages: [
      { role: 'assistant', stopReason: 'error', errorMessage: 'x' },
    ] }, 'pi_x');
    expect(out?.payload.type).toBe('turn.failed');
  });

  it('F8: agent_start ¡ú turn.started£¨²»ÔÙ²ú session.updated ¿Õ¿Ç£©', () => {
    const out = translatePiEvent({ type: 'agent_start' }, 'pi_x');
    expect(out?.payload.type).toBe('turn.started');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('F1 È«Á´£ºerror ÖÕÌ¬¾­ normalize ²ú³ö chatSignal=error£¨goalDriver onSessionError Â·¾¶£©', () => {
    const mapped = translatePiEvent({ type: 'agent_end', messages: [
      { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
    ] }, 'pi_x');
    const facets = normalizeOpencodeEvent(mapped!);
    expect(facets.chatSignal).toBe('error');
  });
});
