import { createMimoEngine } from '../../src/tts/mimo-engine';

const TEST_CREDENTIALS = { getApiKey: () => 'test-key' };

function sseBody(lines: string[]): Response {
  const text = lines.map(l => `data: ${l}\n\n`).join('');
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  }), { status: 200 });
}

describe('mimo engine', () => {
  test('capabilities declare native streaming at 24kHz with style control', () => {
    const engine = createMimoEngine({ config: () => ({}), credentials: TEST_CREDENTIALS as any });
    expect(engine.name).toBe('mimo');
    expect(engine.capabilities.streaming).toBe('native');
    expect(engine.capabilities.sampleRate).toBe(24000);
    expect(engine.capabilities.styleControl).toBe(true);
  });

  test('synthesizeStream yields PcmChunk buffers decoded from base64 SSE deltas', async () => {
    const pcm = Buffer.from([1, 0, 2, 0]); // 2 个 int16 sample
    const b64 = pcm.toString('base64');
    const fetchImpl = async () => sseBody([
      JSON.stringify({ choices: [{ delta: { audio: { data: b64 } } }] }),
      '[DONE]',
    ]) as any;
    const engine = createMimoEngine({ config: () => ({}), fetchImpl: fetchImpl as any, credentials: TEST_CREDENTIALS as any });
    const chunks: { pcm: Buffer; sampleRate: number }[] = [];
    for await (const c of engine.synthesizeStream('你好', {}, new AbortController().signal)) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pcm.equals(pcm)).toBe(true);
    expect(chunks[0].sampleRate).toBe(24000);
  });

  test('synthesize returns wav buffer from base64 data payload', async () => {
    const wav = Buffer.from('RIFF....WAVEfmt fake');
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: wav.toString('base64') } } }],
    }), { status: 200 }) as any;
    const engine = createMimoEngine({ config: () => ({}), fetchImpl: fetchImpl as any, credentials: TEST_CREDENTIALS as any });
    const out = await engine.synthesize('你好', {});
    expect(out.equals(wav)).toBe(true);
  });
});
