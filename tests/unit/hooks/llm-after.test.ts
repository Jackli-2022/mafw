import { llmAfterHook } from '../../../src/hooks/llm-after';

describe('llmAfterHook', () => {
  test('handles llm after event', async () => {
    const ctx = { sessionID: 'test', text: 'The answer is 42' };
    await expect(llmAfterHook(ctx as any)).resolves.toBeUndefined();
  });

  test('skips when no text', async () => {
    const ctx = { sessionID: 'test' };
    await expect(llmAfterHook(ctx as any)).resolves.toBeUndefined();
  });
});
