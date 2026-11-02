import { createMediaRuntimeExecutor } from '../../src/media/media-runtime-executor';

jest.mock('../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const videoPart = { type: 'file', url: 'data:video/mp4;base64,AAAA', mime: 'video/mp4' };
const textPart = { type: 'text', text: 'what happens?' };

/** access 的 can() 子集：未列出 = false（与 RuntimeAccess 的缺失面一致）。 */
function fakeAccess(over: Record<string, boolean> = {}) {
  return { can: (id: string) => over[id] ?? false };
}

describe('MediaRuntimeExecutor default completeFn', () => {
  it('routes video/audio through the injected completion channel when the surface is available', async () => {
    const completeCalls: any[] = [];
    const complete = {
      complete: async (req: any) => {
        completeCalls.push(req);
        return { text: 'a cat jumps' };
      },
    };
    const fakeRt: any = { session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      projectDir: '/tmp/proj',
      access: fakeAccess({ 'completion.channel': true }),
      completion: () => complete,
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('a cat jumps');
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0].user).toEqual([
      { type: 'text', text: 'what happens?' },
      { type: 'image', data: 'AAAA', mimeType: 'video/mp4' },
    ]);
  });

  it('denied completion.channel never calls completion and falls back', async () => {
    const complete = {
      complete: jest.fn(async () => ({ text: 'must not be used' })),
    };
    const fakeRt: any = { session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      projectDir: '/tmp/proj',
      access: fakeAccess({ 'completion.channel': false }),
      completion: () => complete,
      completeFn: async () => 'legacy adapter result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('legacy adapter result');
    expect(complete.complete).not.toHaveBeenCalled();
  });

  it('falls back to opts.completeFn when no access/surface is wired', async () => {
    const fakeRt: any = { session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      projectDir: '/tmp/proj',
      completeFn: async () => 'legacy adapter result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('legacy adapter result');
  });

  it('falls back to opts.completeFn when the completion channel throws', async () => {
    const fakeRt: any = { session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      projectDir: '/tmp/proj',
      access: fakeAccess({ 'completion.channel': true }),
      completion: () => ({ complete: async () => { throw new Error('boom'); } }),
      completeFn: async () => 'fallback result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('fallback result');
  });

  it('falls back when the surface is present but the channel is not wired', async () => {
    const fakeRt: any = { session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      projectDir: '/tmp/proj',
      access: fakeAccess({ 'completion.channel': true }),
      completeFn: async () => 'no channel result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('no channel result');
  });

  it('image 路径：从 flat 历史（canonical v3，含 reasoning part）提取最后 assistant 文本', async () => {
    const imagePart = { type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' };
    const created: any[] = [];
    const sessionCreate = jest.fn(async () => ({ id: 'wrong' }));
    const fakeRt: any = {
      capabilities: {},
      mediaSession: {
        create: async (opts: any) => { created.push(opts); return { id: 's1' }; },
      },
      session: {
        create: sessionCreate,
        promptAsync: async () => {},
        messages: async () => ({
          data: [
            { id: 'u1', role: 'user', content: [{ type: 'text', text: 'q' }] },
            { id: 'a1', role: 'assistant', content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'a cat' }, { type: 'tool' as any, tool: 'x' }] },
          ],
        }),
      },
    };
    const executor = createMediaRuntimeExecutor(fakeRt, { projectDir: '/tmp/proj' });
    const out = await executor.prompt([imagePart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('a cat'); // reasoning 不泄漏（type==='text' 过滤必须作用于 flat content）
    // 会话必须经 media.session 通道创建（带显式目录），不走裸 session.create
    expect(created).toEqual([{ directory: '/tmp/proj' }]);
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});
