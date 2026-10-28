import { AsrEngineRegistry } from '../../src/voice/registry';
import type { AsrEngine } from '../../src/voice/types';

function fakeAsr(name: string): AsrEngine {
  return {
    name,
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push: () => {}, end: async () => ({ text: '', durationMs: 0, engine: name, final: true }), abort: () => {}, onPartial: () => {} }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
  };
}

test('resolves a registered engine by name', () => {
  const r = new AsrEngineRegistry();
  r.register(fakeAsr('qwen3-asr-vllm'));
  expect(r.resolve('qwen3-asr-vllm').name).toBe('qwen3-asr-vllm');
});

test('resolves the default engine when name is omitted', () => {
  const r = new AsrEngineRegistry();
  r.register(fakeAsr('qwen3-asr-vllm'));
  expect(r.resolve().name).toBe('qwen3-asr-vllm');
});

test('throws for unknown engine', () => {
  const r = new AsrEngineRegistry();
  expect(() => r.resolve('nope')).toThrow(/unknown asr engine/i);
});

test('list reports capabilities and source', () => {
  const r = new AsrEngineRegistry();
  r.register(fakeAsr('qwen3-asr-vllm'));
  expect(r.list()[0]).toMatchObject({ name: 'qwen3-asr-vllm', source: 'builtin' });
});

test('rejects invalid capabilities at registration', () => {
  const r = new AsrEngineRegistry();
  const engine = fakeAsr('bad');
  engine.capabilities = { ...engine.capabilities, sampleRate: 0 };
  expect(() => r.register(engine)).toThrow(/sampleRate/);
});
