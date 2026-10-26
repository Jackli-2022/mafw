import { isMafwMessage, type MafwMessage } from '../../../src/runtime/canonical-types';

describe('canonical part signature', () => {
  it('reasoning signature/native survive structural validation', () => {
    const message: MafwMessage = {
      id: 'm1',
      role: 'assistant',
      content: [{
        id: 'p1', type: 'reasoning', text: 'thinking',
        signature: 'sig-1', native: { opaque: true },
      }],
    };
    expect(isMafwMessage(message)).toBe(true);
    expect(message.content?.[0]).toMatchObject({ signature: 'sig-1', native: { opaque: true } });
  });
});
