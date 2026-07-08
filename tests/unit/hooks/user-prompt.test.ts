import { userPromptHook } from '../../../src/hooks/user-prompt';

describe('userPromptHook', () => {
  test('handles user prompt event', async () => {
    const ctx = { sessionID: 'test', text: 'implement auth' };
    await expect(userPromptHook(ctx as any)).resolves.toBeUndefined();
  });

  test('skips when no text', async () => {
    const ctx = { sessionID: 'test' };
    await expect(userPromptHook(ctx as any)).resolves.toBeUndefined();
  });
});
