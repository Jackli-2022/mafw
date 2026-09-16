import { resolveMediaPrompt } from '../../src/media/resolve-prompt';
import type { MediaEngine } from '../../src/media/media-plugin-loader';

const builtinPi = jest.fn(() => undefined);
const userPrompt = (async () => 'user') as any;

function engines(entries: Record<string, Partial<MediaEngine>>): Map<string, MediaEngine> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, v as MediaEngine]));
}

describe('resolveMediaPrompt', () => {
  beforeEach(() => builtinPi.mockClear());

  it('未知引擎回退 builtinPi', () => {
    const r = resolveMediaPrompt('nope', 'image', { engines: engines({}), builtinPi });
    expect(r).toBeUndefined();
    expect(builtinPi).toHaveBeenCalled();
  });

  it('内置 pi 走 builtinPi（executor/direct 由调用点决定）', () => {
    const e = engines({ pi: { builtin: true, modalities: ['image', 'video', 'audio'], prompt: userPrompt } });
    const r = resolveMediaPrompt('pi', 'image', { engines: e, builtinPi });
    expect(r).toBeUndefined();
    expect(builtinPi).toHaveBeenCalled();
  });

  it('用户插件覆盖 pi：同名非 builtin 直接返回用户 prompt', () => {
    const e = engines({ pi: { modalities: ['image'], prompt: userPrompt } });
    const r = resolveMediaPrompt('pi', 'image', { engines: e, builtinPi });
    expect(r).toBe(userPrompt);
    expect(builtinPi).not.toHaveBeenCalled();
  });

  it('用户 pi 不支持该 modality → 回退 builtinPi', () => {
    const e = engines({ pi: { modalities: ['image'], prompt: userPrompt } });
    const r = resolveMediaPrompt('pi', 'video', { engines: e, builtinPi });
    expect(r).toBeUndefined();
    expect(builtinPi).toHaveBeenCalled();
  });

  it('普通用户引擎正常返回', () => {
    const e = engines({ 'qwen-vl': { modalities: ['image', 'video'], prompt: userPrompt } });
    expect(resolveMediaPrompt('qwen-vl', 'video', { engines: e, builtinPi })).toBe(userPrompt);
  });
});
