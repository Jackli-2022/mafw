import { translatePiEvent } from '../../../src/runtime/pi/pi-events';
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

describe('translatePiEvent', () => {
  it('agent_end maps to session.idle (not session.updated)', () => {
    const out = translatePiEvent({ type: 'agent_end' }, 'pi_x');
    expect(out?.payload.type).toBe('session.idle');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('message_update maps to message.part.updated with delta text', () => {
    const out = translatePiEvent({ type: 'message_update', delta: 'hi' }, 'pi_x');
    expect(out?.payload.type).toBe('message.part.updated');
    expect(out?.payload.properties.part.text).toBe('hi');
  });

  it('turn_end maps to step-finish part with messageID (bug fix: facet reads messageID)', () => {
    const out = translatePiEvent({ type: 'turn_end' }, 'pi_x');
    expect(out?.payload.type).toBe('message.part.updated');
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