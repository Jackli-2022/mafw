import { TtsEngineRegistry, DEFAULT_ENGINE } from '../../../src/kernel-v2/providers/tts-registry';
import type { PcmChunk, TtsEngine, TtsProfile } from '../../../src/tts/types';
import { log } from '../../../src/core/utils/logger';

const profile = (over: Partial<TtsProfile> = {}): TtsProfile => ({
  streaming: 'native',
  voiceCloning: false,
  styleControl: false,
  languages: ['zh'],
  sampleRate: 24000,
  ...over,
});

function fakeEngine(name: string, label = name): TtsEngine {
  return {
    name,
    profile: profile(),
    voices: () => [{ id: label, label, lang: 'zh' }],
    async *synthesizeStream(): AsyncIterable<PcmChunk> {
      // no chunks
    },
    async synthesize(): Promise<Buffer> {
      return Buffer.from(label);
    },
  };
}

describe('TtsEngineRegistry over CapabilityRegistry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('builtin default engine remains mimo', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine(DEFAULT_ENGINE));
    expect(reg.resolve()).toBeDefined();
    expect(reg.resolve().name).toBe(DEFAULT_ENGINE);
  });

  test('package engine overrides builtin under the same name', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine(DEFAULT_ENGINE, 'builtin'));
    reg.setPackageEngines([fakeEngine(DEFAULT_ENGINE, 'package')]);
    expect(reg.resolve(DEFAULT_ENGINE).voices()[0].label).toBe('package');
    expect(reg.list().find((e) => e.name === DEFAULT_ENGINE)?.source).toBe('package');
  });

  test('clearing the package tier restores the builtin engine', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine(DEFAULT_ENGINE, 'builtin'));
    reg.setPackageEngines([fakeEngine(DEFAULT_ENGINE, 'package')]);
    reg.setPackageEngines([]);
    expect(reg.resolve(DEFAULT_ENGINE).voices()[0].label).toBe('builtin');
    expect(reg.list().find((e) => e.name === DEFAULT_ENGINE)?.source).toBe('builtin');
  });

  test('unknown engine falls back to the default and keeps the legacy warning text', () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine(DEFAULT_ENGINE));
    expect(reg.resolve('missing').name).toBe(DEFAULT_ENGINE);
    expect(warn).toHaveBeenCalledWith(`[TTS] unknown engine "missing", falling back to ${DEFAULT_ENGINE}`);
  });

  test('empty engine name uses the default without warning', () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine(DEFAULT_ENGINE));
    expect(reg.resolve('').name).toBe(DEFAULT_ENGINE);
    expect(warn).not.toHaveBeenCalled();
  });

  test('list keeps first-seen order and reports the winning tier', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('a'));
    reg.registerBuiltin(fakeEngine('b'));
    reg.setLegacyEngines([fakeEngine('b'), fakeEngine('c')]);
    expect(reg.list()).toEqual([
      { name: 'a', profile: profile(), source: 'builtin' },
      { name: 'b', profile: profile(), source: 'legacy' },
      { name: 'c', profile: profile(), source: 'legacy' },
    ]);
  });

  test('dispose is idempotent and closes resolution', async () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine(DEFAULT_ENGINE));
    await reg.dispose();
    await expect(reg.dispose()).resolves.toBeUndefined();
    expect(() => reg.resolve()).toThrow(/disposed/);
  });
});
