import { injectWakePrompt } from '../../../gateway/src/core/manager/wake-handlers';
import { RuntimeClient } from '../../../gateway/src/runtime/contract';

function createMockClient(): RuntimeClient {
  return {
    session: {
      create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      promptAsync: jest.fn().mockResolvedValue(undefined),
      prompt: jest.fn().mockResolvedValue({ parts: [] }),
      messages: jest.fn().mockResolvedValue({ data: [] }),
      get: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue(undefined),
      abort: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      todo: jest.fn().mockResolvedValue([]),
      children: jest.fn().mockResolvedValue([]),
      summarize: jest.fn().mockResolvedValue({}),
    },
    global: { event: jest.fn().mockResolvedValue({}) },
    provider: { list: jest.fn().mockResolvedValue({ all: [], connected: [], default: {} }) },
    app: { agents: jest.fn().mockResolvedValue([]) },
    config: { get: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
  };
}

describe('injectWakePrompt — dependency injection', () => {
  it('calls promptAsync on the injected RuntimeClient with correct args', async () => {
    const client = createMockClient();
    await injectWakePrompt(client, '/proj', 'sess-123', 'report_completed', 2, 1);

    expect(client.session.promptAsync).toHaveBeenCalledTimes(1);
    const call = (client.session.promptAsync as jest.Mock).mock.calls[0][0];
    expect(call.sessionID).toBe('sess-123');
    expect(call.parts).toEqual([{ type: 'text', text: expect.stringContaining('2 completed') }]);
    expect(call.parts[0].text).toContain('1 failed');
  });

  it('does not depend on opencode-adapter module', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../gateway/src/core/manager/wake-handlers.ts'),
      'utf-8',
    );
    expect(source).not.toContain('opencode-adapter');
    expect(source).not.toContain('createOpencodeAdapter');
  });

  it('handles promptAsync failure gracefully (no throw)', async () => {
    const client = createMockClient();
    (client.session.promptAsync as jest.Mock).mockRejectedValue(new Error('connection refused'));

    await expect(injectWakePrompt(client, '/proj', 'sess-789', 'report_question', 1, 0))
      .resolves.toBeUndefined();
  });
});
