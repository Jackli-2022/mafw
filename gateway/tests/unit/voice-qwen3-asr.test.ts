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

test('transcribe posts base64 audio to /transcribe', async () => {
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
  expect(calls[0].body.audio_b64).toBe(Buffer.from('abc').toString('base64'));
});
