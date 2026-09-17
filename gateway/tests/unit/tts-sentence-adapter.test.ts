import { splitSentences, adaptToStream } from '../../src/tts/sentence-adapter';
import type { TtsEngine, TtsCapabilities } from '../../src/tts/types';

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

const capsNone: TtsCapabilities = {
  streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 22050,
};

describe('adaptToStream', () => {
  test('yields one PCM chunk per sentence with engine sampleRate', async () => {
    const calls: string[] = [];
    const engine: TtsEngine = {
      name: 'fake', capabilities: capsNone,
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
      name: 'fake', capabilities: capsNone,
      voices: () => [],
      async synthesize() { ctrl.abort(); return wavBuffer(10); },
      async *synthesizeStream() { throw new Error('x'); },
    };
    const chunks: unknown[] = [];
    for await (const c of adaptToStream(engine, '一。二。三。', {}, ctrl.signal)) chunks.push(c);
    expect(chunks.length).toBeLessThan(3);
  });
});
