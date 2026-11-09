import { PiTurnAttribution } from '../../../../adapters/pi/src/pi-turn-attribution';
import type { AdapterEvent } from '@mafw/runtime-contract';

let seq = 0;
function evt(type: AdapterEvent['type'], extra: Partial<AdapterEvent> = {}): AdapterEvent {
  seq += 1;
  return {
    id: `e-${seq}`,
    type,
    sessionID: 's1',
    at: Date.now(),
    data: {},
    ...extra,
  } as AdapterEvent;
}

describe('PiTurnAttribution', () => {
  it('promotes the queued id on turn.started and attaches it to every frame', () => {
    const attr = new PiTurnAttribution();
    attr.enqueue('s1', 't1');

    expect(attr.attribute(evt('turn.started')).turnID).toBe('t1');
    expect(attr.attribute(evt('message.updated')).turnID).toBe('t1');
    expect(attr.attribute(evt('turn.completed')).turnID).toBe('t1');
  });

  it('keeps a queued follow-up on its own id until the next start', () => {
    const attr = new PiTurnAttribution();
    attr.enqueue('s1', 't1');
    attr.enqueue('s1', 't2');

    expect(attr.attribute(evt('turn.started')).turnID).toBe('t1');
    expect(attr.attribute(evt('turn.completed')).turnID).toBe('t1');
    // The queued follow-up keeps its own id; the terminal above consumed t1.
    expect(attr.attribute(evt('turn.started')).turnID).toBe('t2');
    expect(attr.attribute(evt('turn.completed')).turnID).toBe('t2');
  });

  it('mints a fallback id for a native run that bypassed sendTurn', () => {
    const attr = new PiTurnAttribution();
    const started = attr.attribute(evt('turn.started'));
    expect(started.turnID).toMatch(/^pi_turn_s1_/);
    const completed = attr.attribute(evt('turn.completed'));
    expect(completed.turnID).toBe(started.turnID);
    // The fallback is retired with the terminal.
    expect(attr.attribute(evt('message.updated')).turnID).toBeUndefined();
  });

  it('does not promote a queued turn on an automatic retry start', () => {
    const attr = new PiTurnAttribution();
    attr.enqueue('s1', 't1');
    attr.enqueue('s1', 't2');

    expect(attr.attribute(evt('turn.started')).turnID).toBe('t1');
    // pi retries emit another agent_start within the same logical turn.
    expect(attr.attribute(evt('turn.started')).turnID).toBe('t1');
    expect(attr.attribute(evt('turn.completed')).turnID).toBe('t1');
    expect(attr.attribute(evt('turn.started')).turnID).toBe('t2');
  });

  it('withdrawing a failed turn does not consume the next queued turn', () => {
    const attr = new PiTurnAttribution();
    attr.enqueue('s1', 't1');
    attr.enqueue('s1', 't2');
    attr.withdraw('s1', 't1');

    const failure = attr.attribute(evt('turn.failed', { turnID: 't1' }));
    expect(failure.turnID).toBe('t1');
    // t2 is still the head and must be promoted by its own start.
    expect(attr.attribute(evt('turn.started')).turnID).toBe('t2');
  });

  it('abort terminates the active id and drops late frames until the next start', () => {
    const attr = new PiTurnAttribution();
    attr.enqueue('s1', 't1');
    attr.enqueue('s1', 't2');
    attr.attribute(evt('turn.started'));
    expect(attr.abort('s1')).toBe('t1');
    // A late native terminal must not mint a second terminal.
    expect(attr.attribute(evt('turn.completed'))).toBeNull();
    expect(attr.attribute(evt('turn.started')).turnID).toBe('t2');
  });

  it('leaves sessionless events untouched', () => {
    const attr = new PiTurnAttribution();
    const notice = evt('runtime.notice', { sessionID: undefined });
    expect(attr.attribute(notice)).toBe(notice);
  });
});
