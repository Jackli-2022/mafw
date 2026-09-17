import { TtsEngineRegistry } from '../../src/tts/registry';
import type { TtsCapabilities, TtsEngine, PcmChunk } from '../../src/tts/types';

const caps = (over: Partial<TtsCapabilities> = {}): TtsCapabilities => ({
  streaming: 'native', voiceCloning: false, styleControl: false,
  languages: ['zh'], sampleRate: 24000, ...over,
});

function fakeEngine(name: string): TtsEngine {
  return {
    name,
    capabilities: caps(),
    voices: () => [{ id: 'v1', label: 'V1', lang: 'zh' }],
    async *synthesizeStream(): AsyncIterable<PcmChunk> { /* empty */ },
    async synthesize(): Promise<Buffer> { return Buffer.from('wav'); },
  };
}

describe('TtsEngineRegistry', () => {
  test('resolve returns builtin by name', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    expect(reg.resolve('mimo').name).toBe('mimo');
  });

  test('resolve with no name returns default engine (mimo)', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    expect(reg.resolve().name).toBe('mimo');
  });

  test('unknown engine falls back to default with warn flag', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    const e = reg.resolve('nonexistent');
    expect(e.name).toBe('mimo');
  });

  test('resolve throws when no engine registered at all', () => {
    const reg = new TtsEngineRegistry();
    expect(() => reg.resolve()).toThrow(/no tts engine/i);
  });

  test('priority: package > legacy > builtin on same name', () => {
    const reg = new TtsEngineRegistry();
    const b = fakeEngine('x'); b.voices = () => [{ id: 'b', label: 'builtin', lang: 'zh' }];
    const l = fakeEngine('x'); l.voices = () => [{ id: 'l', label: 'legacy', lang: 'zh' }];
    const p = fakeEngine('x'); p.voices = () => [{ id: 'p', label: 'pkg', lang: 'zh' }];
    reg.registerBuiltin(b);
    reg.setLegacyEngines([l]);
    expect(reg.resolve('x').voices()[0].label).toBe('legacy');
    reg.setPackageEngines([p]);
    expect(reg.resolve('x').voices()[0].label).toBe('pkg');
  });

  test('list reports source for each engine', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    reg.setLegacyEngines([fakeEngine('custom')]);
    const list = reg.list();
    expect(list.find(e => e.name === 'mimo')?.source).toBe('builtin');
    expect(list.find(e => e.name === 'custom')?.source).toBe('legacy');
  });
});
