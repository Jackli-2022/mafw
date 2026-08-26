import { translatePiMessages, piMessagesToParts } from '../../../src/runtime/pi/pi-messages';

describe('translatePiMessages', () => {
  it('maps role and text content to opencode shape', () => {
    const out = translatePiMessages([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ], 'pi_x');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'user', sessionID: 'pi_x', content: [{ type: 'text', text: 'hi' }] });
    expect(out[1].role).toBe('assistant');
    expect(out[0].id).toBeDefined();
    expect(out[0].time.created).toBeDefined();
  });

  it('strips non-text content (images) but keeps text', () => {
    const out = translatePiMessages([
      { role: 'user', content: [{ type: 'text', text: 'q' }, { type: 'image', data: 'AAAA' }] },
    ], 'pi_x');
    expect(out[0].content).toEqual([{ type: 'text', text: 'q' }]);
  });

  it('piMessagesToParts extracts text parts', () => {
    const parts = piMessagesToParts([
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ]);
    expect(parts).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  });
});