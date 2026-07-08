import { toolBeforeHook } from '../../../src/hooks/tool-before';

describe('toolBeforeHook', () => {
  test('handles tool before event', async () => {
    const ctx = { tool: 'read', sessionID: 'test' };
    const result = await toolBeforeHook(ctx as any);
    expect(result).toBeUndefined();
  });
});
