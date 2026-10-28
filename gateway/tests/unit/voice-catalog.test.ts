import { assertBuiltinLicense, findVoiceModel, voiceModelsFor, VOICE_MODELS } from '../../src/voice/catalog';

test('catalog has the v1 dGPU ASR primary', () => {
  const m = findVoiceModel('qwen3-asr-1.7b-vllm');
  expect(m?.kind).toBe('asr');
  expect(m?.tier).toBe('dgpu');
  expect(m?.engine).toBe('qwen3-asr-vllm');
});

test('iGPU ASR list contains Zipformer and Qwen3 0.6B', () => {
  const ids = voiceModelsFor('asr', 'igpu').map(m => m.id);
  expect(ids).toContain('sherpa-zipformer-bilingual-zh-en');
  expect(ids).toContain('qwen3-asr-0.6b');
});

test('iGPU TTS list contains Kokoro and MeloTTS', () => {
  const ids = voiceModelsFor('tts', 'igpu').map(m => m.id);
  expect(ids).toContain('kokoro-zh-en');
  expect(ids).toContain('melo-zh-en');
});

test('built-in license gate accepts Apache/MIT/BSD and rejects user-plugin', () => {
  const builtin = VOICE_MODELS.find(m => m.id === 'qwen3-asr-1.7b-vllm')!;
  expect(() => assertBuiltinLicense(builtin)).not.toThrow();
  expect(() => assertBuiltinLicense({ ...builtin, license: 'user-plugin' }))
    .toThrow(/user-plugin/);
});
