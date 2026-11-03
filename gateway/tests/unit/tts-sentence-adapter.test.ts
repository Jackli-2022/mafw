import { splitSentences, adaptToStream, streamSentences } from '../../src/tts/sentence-adapter';
import type { TtsEngine, TtsProfile } from '../../src/tts/types';

describe('splitSentences', () => {
  test('splits on Chinese and English sentence punctuation', () => {
    expect(splitSentences('你好。世界！再见？ok.')).toEqual(['你好。', '世界！', '再见？', 'ok.']);
  });

  test('keeps text without punctuation as one sentence', () => {
    expect(splitSentences('没有标点的一段话')).toEqual(['没有标点的一段话']);
  });

  test('splits overly long sentence at maxLen boundary', () => {
    const long = '啊'.repeat(250);
    const parts = splitSentences(long, 100);
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(100);
  });

  test('trims whitespace and drops empty segments', () => {
    expect(splitSentences('  你好。  \n 世界。  ')).toEqual(['你好。', '世界。']);
  });
});

function wavBuffer(pcmBytes: number): Buffer {
  const buf = Buffer.alloc(44 + pcmBytes);
  buf.write('RIFF', 0); buf.write('WAVE', 8); // 其余字段本测试不关心
  return buf;
}

const capsNone: TtsProfile = {
  streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 22050,
};

describe('adaptToStream', () => {
  test('yields one PCM chunk per sentence with engine sampleRate', async () => {
    const calls: string[] = [];
    const engine: TtsEngine = {
      name: 'fake', profile: capsNone,
      voices: () => [],
      async synthesize(text: string) { calls.push(text); return wavBuffer(100); },
      async *synthesizeStream() { throw new Error('not streaming'); },
    };
    const chunks: { pcm: Buffer; sampleRate: number }[] = [];
    for await (const c of adaptToStream(engine, '第一句。第二句！', {}, new AbortController().signal)) {
      chunks.push(c);
    }
    expect(calls).toEqual(['第一句。', '第二句！']);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sampleRate).toBe(22050);
    expect(chunks[0].pcm.length).toBe(100);
  });

  test('stops early when signal aborted', async () => {
    const ctrl = new AbortController();
    const engine: TtsEngine = {
      name: 'fake', profile: capsNone,
      voices: () => [],
      async synthesize() { ctrl.abort(); return wavBuffer(10); },
      async *synthesizeStream() { throw new Error('x'); },
    };
    const chunks: unknown[] = [];
    for await (const c of adaptToStream(engine, '一。二。三。', {}, ctrl.signal)) chunks.push(c);
    expect(chunks.length).toBeLessThan(3);
  });
});

const capsNative: TtsProfile = {
  streaming: 'native', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 24000,
};

describe('streamSentences', () => {
  test('native engine: splits text per sentence instead of one oversized call', async () => {
    const calls: string[] = [];
    const engine: TtsEngine = {
      name: 'fake-native', profile: capsNative,
      voices: () => [],
      async synthesize() { throw new Error('whole-text path should not be used'); },
      async *synthesizeStream(text: string) {
        calls.push(text);
        yield { pcm: Buffer.from(`[${text}]`), sampleRate: 24000 };
      },
    };
    // 250 字无标点长句会被硬切，验证任何单次调用都不超过 maxLen
    const long = '第一句。' + '啊'.repeat(250) + '！最后一句？';
    const chunks: { pcm: Buffer; sampleRate: number }[] = [];
    for await (const c of streamSentences(engine, long, {}, new AbortController().signal)) chunks.push(c);
    expect(calls[0]).toBe('第一句。');
    expect(calls[calls.length - 1]).toBe('最后一句？');
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.every((s) => s.length <= 100)).toBe(true);
    expect(chunks.map((c) => c.pcm.toString()).join('')).toBe(calls.map((s) => `[${s}]`).join(''));
  });

  test('native engine: stops between sentences when aborted', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const engine: TtsEngine = {
      name: 'fake-native', profile: capsNative,
      voices: () => [],
      async synthesize() { throw new Error('x'); },
      async *synthesizeStream() {
        calls++;
        ctrl.abort();
        yield { pcm: Buffer.alloc(1), sampleRate: 24000 };
      },
    };
    const chunks: unknown[] = [];
    for await (const c of streamSentences(engine, '一。二。三。', {}, ctrl.signal)) chunks.push(c);
    expect(calls).toBe(1);
    expect(chunks).toHaveLength(1);
  });

  test('non-streaming engine delegates to adaptToStream (per-sentence synthesize)', async () => {
    const calls: string[] = [];
    const engine: TtsEngine = {
      name: 'fake-none', profile: capsNone,
      voices: () => [],
      async synthesize(text: string) { calls.push(text); return wavBuffer(8); },
      async *synthesizeStream() { throw new Error('nope'); },
    };
    const chunks: unknown[] = [];
    for await (const c of streamSentences(engine, '甲。乙。', {}, new AbortController().signal)) chunks.push(c);
    expect(calls).toEqual(['甲。', '乙。']);
    expect(chunks).toHaveLength(2);
  });
});
