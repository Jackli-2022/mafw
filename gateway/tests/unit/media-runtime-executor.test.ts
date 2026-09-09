import { createMediaRuntimeExecutor } from '../../src/media/media-runtime-executor';

jest.mock('../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const videoPart = { type: 'file', url: 'data:video/mp4;base64,AAAA', mime: 'video/mp4' };
const textPart = { type: 'text', text: 'what happens?' };

describe('MediaRuntimeExecutor default completeFn', () => {
  it('routes video/audio through rt.completion when completionApi is declared', async () => {
    const completeCalls: any[] = [];
    const fakeRt: any = {
      capabilities: { completionApi: true },
      completion: {
        complete: async (req: any) => {
          completeCalls.push(req);
          return { text: 'a cat jumps' };
        },
      },
      session: {},
    };
    const executor = createMediaRuntimeExecutor(fakeRt);
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('a cat jumps');
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0].user).toEqual([
      { type: 'text', text: 'what happens?' },
      { type: 'image', data: 'AAAA', mimeType: 'video/mp4' },
    ]);
  });

  it('falls back to opts.completeFn when the runtime lacks completionApi', async () => {
    const fakeRt: any = { capabilities: {}, session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      completeFn: async () => 'legacy adapter result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('legacy adapter result');
  });

  it('falls back to opts.completeFn when rt.completion throws', async () => {
    const fakeRt: any = {
      capabilities: { completionApi: true },
      completion: { complete: async () => { throw new Error('boom'); } },
      session: {},
    };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      completeFn: async () => 'fallback result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('fallback result');
  });
});
