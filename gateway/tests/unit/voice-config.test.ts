import { DEFAULT_VOICE_CONFIG, resolveVoiceConfig } from '../../src/voice/config';

test('defaults to auto/dgpu/qwen3-asr', () => {
  const c = resolveVoiceConfig({});
  expect(c.tier).toBe('auto');
  expect(c.localTier).toBe('dgpu');
  expect(c.asrEngine).toBe('qwen3-asr-1.7b-vllm');
  expect(c.cloudConsent).toBe(false);
});

test('raw voice block overrides defaults', () => {
  const c = resolveVoiceConfig({ voice: { tier: 'local', localTier: 'igpu', asrEngine: 'sherpa-zipformer' } });
  expect(c.tier).toBe('local');
  expect(c.localTier).toBe('igpu');
  expect(c.asrEngine).toBe('sherpa-zipformer');
});

test('invalid tier falls back to auto', () => {
  expect(resolveVoiceConfig({ voice: { tier: 'bogus' } }).tier).toBe('auto');
});

test('env overrides win over raw config', () => {
  const c = resolveVoiceConfig({ voice: { tier: 'local' } }, { MAFW_VOICE_TIER: 'cloud' });
  expect(c.tier).toBe('cloud');
});

test('modelsDir defaults under ~/.mafw/models/voice', () => {
  expect(DEFAULT_VOICE_CONFIG.modelsDir.replace(/\\/g, '/')).toMatch(/\.mafw\/models\/voice$/);
});
