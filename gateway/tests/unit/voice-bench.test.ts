import { WebSocketServer } from 'ws';
import { runOnce, summarizeBench } from '../../scripts/voice-bench';

test('summarizeBench computes p50 and empty count', () => {
  const r = summarizeBench([
    { firstPartialMs: 100, finalMs: 300, text: 'a' },
    { firstPartialMs: 200, finalMs: 500, text: '' },
    { firstPartialMs: 300, finalMs: 700, text: 'c' },
  ]);
  expect(r.count).toBe(3);
  expect(r.firstPartialP50).toBe(200);
  expect(r.finalP50).toBe(500);
  expect(r.empty).toBe(1);
});

test('runOnce waits for ready and reports relative latency', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const port = (wss.address() as any).port;
  wss.on('connection', (ws) => {
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'ready' }));
      if (msg.type === 'end_audio') {
        ws.send(JSON.stringify({ type: 'asr.partial', text: '你' }));
        setTimeout(() => ws.send(JSON.stringify({
          type: 'asr.final', text: '你好。', language: 'zh', durationMs: 40,
        })), 10);
      }
    });
  });
  const sample = await runOnce(`ws://127.0.0.1:${port}/ws/voice`, Buffer.alloc(1280));
  expect(sample.firstPartialMs).toBeGreaterThanOrEqual(0);
  expect(sample.firstPartialMs!).toBeLessThan(1000);
  expect(sample.finalMs).toBeGreaterThanOrEqual(0);
  expect(sample.finalMs!).toBeLessThan(1000);
  expect(sample.text).toBe('你好。');
  await new Promise<void>(r => wss.close(() => r()));
});
