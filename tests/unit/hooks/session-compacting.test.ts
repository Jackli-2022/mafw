import { sessionCompactingHook } from '../../../src/hooks/session-compacting';

describe('sessionCompactingHook', () => {
  test('handles session compacting event', async () => {
    const result = await sessionCompactingHook({ sessionID: 'test-session' });
    expect(result).toBeUndefined();
  });
});
