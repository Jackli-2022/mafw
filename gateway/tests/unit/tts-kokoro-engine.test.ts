import { createKokoroEngine } from '../../src/tts/kokoro-engine';

describe('kokoro engine', () => {
  test('declares non-streaming capabilities at 24kHz', () => {
    const e = createKokoroEngine({ modelsDir: '/tmp/kokoro-test' });
    expect(e.name).toBe('kokoro');
    expect(e.capabilities.streaming).toBe('none');
    expect(e.capabilities.sampleRate).toBe(24000);
    expect(e.voices().length).toBeGreaterThan(0);
    // kokoro-js 1.2.1 硬编码 v1.0 英文音色集（无 zf_/zm_ 中文）——中文离线兜底待 sherpa-onnx/MeloTTS
    expect(e.voices().every(v => v.lang === 'en')).toBe(true);
  });

  test('synthesize wraps missing kokoro-js into actionable error', async () => {
    const e = createKokoroEngine({
      modelsDir: '/tmp/kokoro-test',
      loadModule: () => Promise.reject(new Error('Cannot find module')),
    });
    await expect(e.synthesize('你好', {})).rejects.toThrow(/kokoro-js/);
  });

  test('synthesize converts RawAudio (no toWav) into wav with RIFF header', async () => {
    // 模拟 kokoro-js RawAudio：{ audio: Float32Array, sampling_rate }（无 toWav 时走 rawToWav 兜底）
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const fakeTts = {
      generate: async () => ({ audio: samples, sampling_rate: 24000 }),
    };
    const e = createKokoroEngine({
      modelsDir: '/tmp/kokoro-test',
      loadModule: () => Promise.resolve({ KokoroTTS: { from_pretrained: async () => fakeTts } }),
    });
    const wav = await e.synthesize('你好', {});
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    // Float32 samples → Int16：0.5 → 16384
    expect(wav.readInt16LE(44 + 2)).toBe(16384);
  });

  test('synthesize failure is retryable (promise cache reset)', async () => {
    let attempts = 0;
    const e = createKokoroEngine({
      modelsDir: '/tmp/kokoro-test',
      loadModule: () => {
        attempts++;
        return attempts === 1
          ? Promise.reject(new Error('transient'))
          : Promise.resolve({ KokoroTTS: { from_pretrained: async () => ({ generate: async () => ({ audio: new Float32Array(4), sampling_rate: 24000 }) }) } });
      },
    });
    await expect(e.synthesize('你好', {})).rejects.toThrow();
    const wav = await e.synthesize('你好', {});
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(attempts).toBe(2);
  });
});
