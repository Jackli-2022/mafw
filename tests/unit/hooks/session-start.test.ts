import { sessionStartHook } from '../../../src/hooks/session-start';

describe('sessionStartHook', () => {
  test('handles session start without error', async () => {
    const ctx = { sessionId: 'test-session' };
    await expect(sessionStartHook(ctx, { mafwDir: '/tmp/test-mafw' })).resolves.toBeUndefined();
  });
});
