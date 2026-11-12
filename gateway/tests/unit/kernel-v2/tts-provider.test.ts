import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import { createTtsCapability } from '../../../src/kernel-v2/providers/tts';
import type { PcmChunk, TtsEngine, TtsProfile } from '../../../src/tts/types';

const profile = (sampleRate = 24000): TtsProfile => ({
  streaming: 'native',
  voiceCloning: false,
  styleControl: false,
  languages: ['zh'],
  sampleRate,
});

function engine(name: string, sampleRate = 24000): TtsEngine {
  return {
    name,
    profile: profile(sampleRate),
    voices: () => [{ id: name, label: name, lang: 'zh' }],
    async *synthesizeStream(): AsyncIterable<PcmChunk> {},
    async synthesize(): Promise<Buffer> {
      return Buffer.from(name);
    },
  };
}

function registry(): CapabilityRegistry<TtsEngine> {
  return new CapabilityRegistry<TtsEngine>({
    defaultId: 'mimo',
    capability: 'tts',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('TTS capability adapter', () => {
  test('resolves the default engine and lists tier/profile', () => {
    const reg = registry();
    reg.register('builtin', { id: 'mimo', value: engine('mimo') });
    reg.register('legacy', { id: 'custom', value: engine('custom', 16000) });
    const tts = createTtsCapability(reg);
    expect(tts.resolve().name).toBe('mimo');
    expect(tts.list()).toEqual([
      { id: 'mimo', profile: profile(), tier: 'builtin' },
      { id: 'custom', profile: profile(16000), tier: 'legacy' },
    ]);
  });

  test('package overrides legacy overrides builtin', () => {
    const reg = registry();
    reg.register('builtin', { id: 'x', value: engine('builtin') });
    reg.register('legacy', { id: 'x', value: engine('legacy') });
    reg.register('package', { id: 'x', value: engine('package') });
    const tts = createTtsCapability(reg);
    expect(tts.resolve('x').name).toBe('package');
    expect(tts.list().find((item) => item.id === 'x')?.tier).toBe('package');
  });

  test('unknown id falls back to the default', () => {
    const reg = registry();
    reg.register('builtin', { id: 'mimo', value: engine('mimo') });
    const tts = createTtsCapability(reg);
    expect(tts.resolve('missing').name).toBe('mimo');
  });

  test('failed health falls back to a lower tier', () => {
    const reg = registry();
    reg.register('builtin', { id: 'mimo', value: engine('mimo') });
    reg.register('package', {
      id: 'mimo',
      value: engine('mimo', 8000),
      health: () => 'failed',
    });
    const tts = createTtsCapability(reg);
    expect(tts.resolve().profile.sampleRate).toBe(24000);
  });

  test('scoped resolution uses the requested scope', () => {
    const reg = registry();
    const global = { kind: 'global' } as const;
    const project = { kind: 'project', projectId: 'p1' } as const;
    reg.register('builtin', { id: 'mimo', value: engine('global') }, global);
    reg.register('builtin', { id: 'mimo', value: engine('project') }, project);
    const tts = createTtsCapability(reg);
    expect(tts.resolve('mimo', global).name).toBe('global');
    expect(tts.resolve('mimo', project).name).toBe('project');
  });
});
