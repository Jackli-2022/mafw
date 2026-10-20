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
    const executor = createMediaRuntimeExecutor(fakeRt, { projectDir: '/tmp/proj' });
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
      projectDir: '/tmp/proj',
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
      projectDir: '/tmp/proj',
      completeFn: async () => 'fallback result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('fallback result');
  });

  it('image 路径：从归一 DTO（{info, parts}）提取最�?assistant 文本', async () => {
    const imagePart = { type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' };
    const created: any[] = [];
    const fakeRt: any = {
      capabilities: {},
      session: {
        create: async (opts: any) => { created.push(opts); return { id: 's1' }; },
        promptAsync: async () => {},
        messages: async () => ({
          data: [
            { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'q' }] },
            { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'text', text: 'a cat' }, { type: 'tool', tool: 'x' }] },
          ],
        }),
      },
    };
    const executor = createMediaRuntimeExecutor(fakeRt, { projectDir: '/tmp/proj' });
    const out = await executor.prompt([imagePart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('a cat');
    // 会话创建必须带显式目录（此前是 { directory: undefined }）
    expect(created).toEqual([{ directory: '/tmp/proj' }]);
  });
});
