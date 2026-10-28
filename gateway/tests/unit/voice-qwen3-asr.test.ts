import { WebSocketServer } from 'ws';
import { Qwen3AsrEngine } from '../../src/voice/engines/asr/qwen3-vllm';

test('streams partial and final over the sidecar WS', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const port = (wss.address() as any).port;
  wss.on('connection', (ws) => {
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'start') ws.send(JSON.stringify({ type: 'partial', text: '你' }));
      if (msg.type === 'end') {
        ws.send(JSON.stringify({ type: 'partial', text: '你好' }));
        ws.send(JSON.stringify({ type: 'final', text: '你好。', language: 'zh', durationMs: 40 }));
      }
    });
  });
  const engine = new Qwen3AsrEngine({
    sidecar: { wsUrl: `ws://127.0.0.1:${port}/stream`, isReady: async () => true } as any,
  });
  const stream = engine.createStream({ sessionId: 's1', language: 'zh', sampleRate: 16000 });
  const partials: string[] = [];
  stream.onPartial(t => partials.push(t));
  stream.push(Buffer.alloc(320));
  const final = await stream.end();
  expect(partials).toEqual(['你', '你好']);
  expect(final).toMatchObject({ text: '你好。', language: 'zh', final: true, engine: 'qwen3-asr-vllm' });
  await new Promise<void>(r => wss.close(() => r()));
});

test('transcribe wraps raw PCM16 in a WAV container', async () => {
  const calls: any[] = [];
  const engine = new Qwen3AsrEngine({
    sidecar: { baseUrl: 'http://127.0.0.1:9', isReady: async () => true } as any,
    fetchImpl: (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ text: 'hi', language: 'en', durationMs: 10 }) };
    }) as any,
  });
  const r = await engine.transcribe(Buffer.from('abc'), { sessionId: 's1', language: 'en', sampleRate: 16000 });
  expect(r.text).toBe('hi');
  expect(calls[0].url).toContain('/transcribe');
  const wav = Buffer.from(calls[0].body.audio_b64, 'base64');
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wav.subarray(44).toString()).toBe('abc');
});

test('abort without end does not leave an unhandled rejection', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const port = (wss.address() as any).port;
  wss.on('connection', (ws) => { ws.on('message', () => {}); });
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    const engine = new Qwen3AsrEngine({
      sidecar: { wsUrl: `ws://127.0.0.1:${port}/stream`, isReady: async () => true } as any,
    });
    const stream = engine.createStream({ sessionId: 's1', language: 'zh', sampleRate: 16000 });
    stream.abort();
    await new Promise(r => setTimeout(r, 50));
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await new Promise<void>(r => wss.close(() => r()));
  }
});
