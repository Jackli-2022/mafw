import { assertAsrCapabilities, supportsLanguage, type AsrCapabilities } from '../../src/voice/types';

const caps = (over: Partial<AsrCapabilities> = {}): AsrCapabilities => ({
  streaming: 'native', languages: ['zh'], punctuation: true,
  timestamps: 'none', sampleRate: 16000, ...over,
});

test('rejects non-positive sampleRate', () => {
  expect(() => assertAsrCapabilities(caps({ sampleRate: 0 }))).toThrow(/sampleRate/);
});

test('rejects empty languages', () => {
  expect(() => assertAsrCapabilities(caps({ languages: [] }))).toThrow(/languages/);
});

test('accepts a valid capability set', () => {
  expect(() => assertAsrCapabilities(caps())).not.toThrow();
});

test('supports exact and region-tagged languages', () => {
  expect(supportsLanguage(caps(), 'zh')).toBe(true);
  expect(supportsLanguage(caps(), 'zh-CN')).toBe(true);
  expect(supportsLanguage(caps(), 'en')).toBe(false);
  expect(supportsLanguage(caps(), undefined)).toBe(true);
  expect(supportsLanguage({ languages: ['multi'] }, 'en')).toBe(true);
});
