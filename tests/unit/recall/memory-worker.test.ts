import { MemoryWorker } from '../../../gateway/src/recall/memory-worker';

describe('MemoryWorker (persistent LLM channel)', () => {
  let fakeClient: any;
  let worker: MemoryWorker;

  beforeEach(() => {
    let counter = 0;
    fakeClient = {
      session: {
        create: jest.fn().mockImplementation(async () => ({ data: { id: `w-${++counter}` } })),
        prompt: jest.fn(),
        summarize: jest.fn().mockResolvedValue({ data: true }),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    worker = new MemoryWorker(fakeClient, { directory: '/tmp' });
  });

  test('reuses the created session across prompts', async () => {
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    await worker.prompt('one');
    await worker.prompt('two');
    expect(fakeClient.session.create).toHaveBeenCalledTimes(1);
    expect(fakeClient.session.prompt).toHaveBeenCalledTimes(2);
  });

  test('invalidates the session on failure and re-creates on next call', async () => {
    fakeClient.session.prompt
      .mockRejectedValueOnce(new Error('serve down'))
      .mockResolvedValueOnce({ data: { parts: [{ type: 'text', text: 'recovered' }] } });
    await expect(worker.prompt('boom')).rejects.toThrow('serve down');
    const text = await worker.prompt('again');
    expect(text).toBe('recovered');
    expect(fakeClient.session.create).toHaveBeenCalledTimes(2);
  });

  test('session is persistent (no rotation across prompts)', async () => {
    const w = new MemoryWorker(fakeClient, { directory: '/tmp' });
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'x' }] } });
    await w.prompt('1');
    await w.prompt('2');
    await w.prompt('3');
    expect(fakeClient.session.create).toHaveBeenCalledTimes(1); // same session reused
    expect(fakeClient.session.delete).not.toHaveBeenCalled();
  });

  test('onSessionCreated fires with the new session id', async () => {
    const created: string[] = [];
    const w = new MemoryWorker(fakeClient, { directory: '/tmp', onSessionCreated: (sid) => created.push(sid) });
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'x' }] } });
    await w.prompt('q');
    expect(created.length).toBe(1);
    expect(created[0]).toMatch(/^w/);
  });

  test('prompt body includes pinned model when passed as argument', async () => {
    const pinned = { providerID: 'xiaomi', modelID: 'mimo-v2.5' };
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    await worker.prompt('hello', 'sys', pinned);
    expect(fakeClient.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ model: pinned }),
      }),
    );
  });

  test('prompt body omits model field when not passed', async () => {
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    await worker.prompt('hello');
    const call = fakeClient.session.prompt.mock.calls[0][0];
    expect(call.body.model).toBeUndefined();
  });

  test('returns joined text parts only', async () => {
    fakeClient.session.prompt.mockResolvedValue({
      data: { parts: [{ type: 'text', text: 'a' }, { type: 'tool', text: 'b' }, { type: 'text', text: 'c' }] },
    });
    const text = await worker.prompt('q');
    expect(text).toBe('a\nc');
  });

  test('dispose deletes the session', async () => {
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'x' }] } });
    await worker.prompt('q');
    await worker.dispose();
    expect(fakeClient.session.delete).toHaveBeenCalledTimes(1);
  });

  test('does not summarize within the compact idle window', async () => {
    jest.useFakeTimers();
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    await worker.prompt('one');
    jest.advanceTimersByTime(7 * 60 * 60 * 1000); // 7h later
    await worker.prompt('two');
    expect(fakeClient.session.summarize).not.toHaveBeenCalled();
    expect(fakeClient.session.create).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('summarizes an idle session before the next prompt and continues', async () => {
    jest.useFakeTimers();
    const pinned = { providerID: 'xiaomi', modelID: 'mimo-v2.5' };
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    await worker.prompt('one');
    jest.advanceTimersByTime(9 * 60 * 60 * 1000); // 9h later
    await worker.prompt('two', 'sys', pinned);
    expect(fakeClient.session.summarize).toHaveBeenCalledTimes(1);
    expect(fakeClient.session.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: expect.stringMatching(/^w-/) },
        body: pinned,
        query: { directory: '/tmp' },
      }),
    );
    expect(fakeClient.session.create).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('rotates session when summarize fails', async () => {
    jest.useFakeTimers();
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    fakeClient.session.summarize.mockRejectedValue(new Error('summarize failed'));
    await worker.prompt('one');
    jest.advanceTimersByTime(9 * 60 * 60 * 1000);
    await expect(worker.prompt('two')).rejects.toThrow('summarize failed');
    expect(fakeClient.session.delete).toHaveBeenCalledTimes(1);
    // next prompt recreates session
    fakeClient.session.summarize.mockResolvedValue({ data: true });
    await worker.prompt('three');
    expect(fakeClient.session.create).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  test('compactIdleMs=0 disables summarize', async () => {
    jest.useFakeTimers();
    const w = new MemoryWorker(fakeClient, { directory: '/tmp', compactIdleMs: 0 });
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } });
    await w.prompt('one');
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    await w.prompt('two');
    expect(fakeClient.session.summarize).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
