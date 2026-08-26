import { translatePiEvent } from '../../../src/runtime/pi/pi-events';

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

  it('turn_end maps to step-finish part with assistantMessageID', () => {
    const out = translatePiEvent({ type: 'turn_end' }, 'pi_x');
    expect(out?.payload.type).toBe('message.part.updated');
    expect(out?.payload.properties.part.type).toBe('step-finish');
    expect(out?.payload.properties.part.assistantMessageID).toBeDefined();
  });

  it('unknown event types return null', () => {
    expect(translatePiEvent({ type: 'queue_update' }, 'pi_x')).toBeNull();
  });
});