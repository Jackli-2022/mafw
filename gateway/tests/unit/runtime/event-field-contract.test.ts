import { checkEventFields } from '../../../src/runtime/event-field-contract';

describe('checkEventFields', () => {
  it('known well-formed events produce no warnings', () => {
    expect(checkEventFields({ type: 'session.idle', properties: { sessionID: 's1' } })).toEqual([]);
    expect(checkEventFields({
      type: 'message.part.updated',
      properties: { part: { sessionID: 's1', messageID: 'm1', type: 'text', text: 'hi' } },
    })).toEqual([]);
  });

  it('session.idle without any sessionID warns (breaks compaction flush)', () => {
    const w = checkEventFields({ type: 'session.idle', properties: {} });
    expect(w.some((x) => x.includes('sessionID'))).toBe(true);
  });

  it('message.part.updated text part without text or delta warns', () => {
    const w = checkEventFields({ type: 'message.part.updated', properties: { part: { sessionID: 's1', type: 'text' } } });
    expect(w.some((x) => x.includes('text'))).toBe(true);
  });

  it('session.created without info.id warns (desktop planner yields none)', () => {
    const w = checkEventFields({ type: 'session.created', properties: {} });
    expect(w.some((x) => x.includes('info'))).toBe(true);
  });

  it('permission.asked without requestId/toolName warns', () => {
    const w = checkEventFields({ type: 'permission.asked', properties: { sessionID: 's1' } });
    expect(w.some((x) => x.includes('requestId'))).toBe(true);
    expect(w.some((x) => x.includes('toolName'))).toBe(true);
  });

  it('unknown type warns with canonical/plugin advice', () => {
    const w = checkEventFields({ type: 'my_custom_event', properties: {} });
    expect(w.some((x) => x.includes('plugin:'))).toBe(true);
  });

  it('shape-B flat envelope (payload nesting) is honored', () => {
    const w = checkEventFields({ payload: { type: 'session.idle', properties: {} } });
    expect(w.some((x) => x.includes('sessionID'))).toBe(true);
  });

  it('missing type warns (malformed)', () => {
    expect(checkEventFields({ properties: {} }).length).toBeGreaterThan(0);
  });
});
