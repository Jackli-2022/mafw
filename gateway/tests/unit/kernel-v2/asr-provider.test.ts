import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createAsrCapability,
  registerAsrEngine,
} from '../../../src/kernel-v2/providers/asr';
import type { AsrEngine } from '../../../src/voice/types';

function engine(name: string, over: Partial<AsrEngine> = {}): AsrEngine {
  return {
    name,
    capabilities: {
      streaming: 'native',
      languages: ['zh'],
      punctuation: true,
      timestamps: 'none',
      sampleRate: 16000,
    },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({
      push: () => {},
      end: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
      abort: () => {},
      onPartial: () => {},
    }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
    ...over,
  };
}

function registry() {
  return new CapabilityRegistry<AsrEngine>({
    defaultId: 'qwen3-asr-vllm',
    capability: 'asr',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('ASR capability adapter', () => {
  test('defaults to qwen3 and lists tier/capabilities', () => {
    const reg = registry();
    registerAsrEngine(reg, engine('qwen3-asr-vllm'));
    const asr = createAsrCapability(reg);
    expect(asr.resolve().name).toBe('qwen3-asr-vllm');
    expect(asr.list()[0]).toMatchObject({ id: 'qwen3-asr-vllm', tier: 'builtin' });
  });

  test('package overrides legacy overrides builtin', () => {
    const reg = registry();
    registerAsrEngine(reg, engine('x'));
    registerAsrEngine(reg, engine('x'), 'legacy');
    registerAsrEngine(reg, engine('x'), 'package');
    expect(createAsrCapability(reg).list().find((item) => item.id === 'x')?.tier).toBe(
      'package',
    );
  });

  test('unknown name falls back to the default engine', () => {
    const reg = registry();
    registerAsrEngine(reg, engine('qwen3-asr-vllm'));
    expect(createAsrCapability(reg).resolve('missing').name).toBe('qwen3-asr-vllm');
  });

  test('invalid capabilities fail at registration', () => {
    const reg = registry();
    const bad = engine('bad');
    bad.capabilities = { ...bad.capabilities, sampleRate: 0 };
    expect(() => registerAsrEngine(reg, bad)).toThrow(/sampleRate/);
  });

  test('available() converts a thrown probe into a reason', async () => {
    const reg = registry();
    registerAsrEngine(
      reg,
      engine('qwen3-asr-vllm', {
        isAvailable: async () => {
          throw new Error('down');
        },
      }),
    );
    await expect(createAsrCapability(reg).available()).resolves.toEqual({
      ok: false,
      reason: 'down',
    });
  });

  test('available() reports an unknown engine as unavailable', async () => {
    const reg = registry();
    await expect(createAsrCapability(reg).available('missing')).resolves.toMatchObject({
      ok: false,
    });
  });
});
