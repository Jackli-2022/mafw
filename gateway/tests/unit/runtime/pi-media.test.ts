import { PiSessionRegistry } from '../../../src/runtime/pi/pi-session';
import { partsToPromptInput } from '../../../src/runtime/plugins/pi-runtime';

function fakeSession(over: any = {}) {
  return {
    isStreaming: false,
    messages: [],
    sessionManager: { getLeafId: () => 'leaf_1' },
    prompt: jest.fn(async () => {}),
    waitForIdle: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),
    ...over,
  };
}

function makeRegistry(over: any = {}) {
  let capturedFactories: any[] = [];
  const registry = new PiSessionRegistry(
    {
      createSession: async (opts: any) => {
        capturedFactories = opts.extensionFactories ?? [];
        return { session: fakeSession(over.session) };
      },
    },
    over.opts,
  );
  return { registry, getFactories: () => capturedFactories };
}

describe('session media attachments', () => {
  it('partsToPromptInput collects video/audio instead of dropping', () => {
    const out = partsToPromptInput([
      { type: 'text', text: 'look' },
      { type: 'file', url: 'data:video/mp4;base64,AAA', mime: 'video/mp4', filename: 'clip.mp4' },
      { type: 'file', url: 'data:audio/wav;base64,BBB', mime: 'audio/wav' },
    ]);
    expect(out.media).toHaveLength(2);
    expect(out.media![0]).toMatchObject({ type: 'video', mime: 'video/mp4', filename: 'clip.mp4' });
    expect(out.media![1]).toMatchObject({ type: 'audio', mime: 'audio/wav' });
    expect(out.images).toBeUndefined();
  });

  it('image file parts still convert to ImageContent (regression)', () => {
    const out = partsToPromptInput([
      { type: 'file', url: 'data:image/png;base64,CCC', mime: 'image/png' },
    ]);
    expect(out.images).toEqual([{ type: 'image', mimeType: 'image/png', data: 'CCC' }]);
    expect(out.media).toBeUndefined();
  });

  it('registry.attachMedia + before_provider_request injects into last user message and clears pending', async () => {
    const handlers: Record<string, Function> = {};
    const { registry, getFactories } = makeRegistry();
    const { id } = await registry.create('/cwd', {});
    const ext = getFactories().find((f) => f.name === 'mafw-media');
    expect(ext).toBeDefined();
    ext.factory({ on: (n: string, f: Function) => { handlers[n] = f; } });

    registry.attachMedia(id, [{ type: 'video', url: 'data:video/mp4;base64,AAA', mime: 'video/mp4' }]);
    const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }] }] };
    const out: any = handlers['before_provider_request']({ payload });
    const content = out.messages[0].content;
    expect(content.some((c: any) => c.type === 'video_url')).toBe(true);

    // pending 清空：再次触发不注入（返回 undefined = 不改写），且原 payload 未被污染
    const out2: any = handlers['before_provider_request']({ payload });
    expect(out2).toBeUndefined();
    expect(payload.messages[0].content.some((c: any) => c.type === 'video_url')).toBe(true); // 第一次注入的残留内容在 payload 上，但不再追加
  });

  it('audio media maps to input_audio wire shape', async () => {
    const handlers: Record<string, Function> = {};
    const { registry, getFactories } = makeRegistry();
    const { id } = await registry.create('/cwd', {});
    const ext = getFactories().find((f) => f.name === 'mafw-media');
    ext.factory({ on: (n: string, f: Function) => { handlers[n] = f; } });

    registry.attachMedia(id, [{ type: 'audio', url: 'data:audio/wav;base64,BBB', mime: 'audio/wav' }]);
    const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'listen' }] }] };
    const out: any = handlers['before_provider_request']({ payload });
    const block = out.messages[0].content.find((c: any) => c.type === 'input_audio');
    expect(block.input_audio.data).toBe('data:audio/wav;base64,BBB');
  });

  it('no pending media → before_provider_request untouched', async () => {
    const handlers: Record<string, Function> = {};
    const { registry, getFactories } = makeRegistry();
    const { id } = await registry.create('/cwd', {});
    const ext = getFactories().find((f) => f.name === 'mafw-media');
    ext.factory({ on: (n: string, f: Function) => { handlers[n] = f; } });
    const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] };
    const out = handlers['before_provider_request']({ payload });
    expect(out).toBeUndefined(); // undefined = 不改写
  });
});
