/**
 * Minimal `/ws/voice` server for the P1 sidecar benchmark.
 *
 * It deliberately does not boot MafwScheduler (DB, automations, serve sidecar):
 * the benchmark needs the real gateway voice transport + session + ASR adapter,
 * not an entire production gateway sharing the live database.
 *
 * Usage:
 *   npx ts-node gateway/scripts/voice-bench-server.ts
 *   npx ts-node gateway/scripts/voice-bench.ts --url ws://127.0.0.1:3001/ws/voice ...
 */
import { WebSocketServer } from 'ws';
import { Qwen3AsrEngine } from '../src/voice/engines/asr/qwen3-vllm';
import { VoiceSession } from '../src/voice/session';
import { attachVoiceSocket } from '../src/voice/transport/ws-voice';

const port = Number(process.env.VOICE_BENCH_PORT ?? 3001);
const baseUrl = process.env.VOICE_SIDECAR_HTTP ?? 'http://127.0.0.1:3911';
const wsUrl = process.env.VOICE_SIDECAR_WS ?? 'ws://127.0.0.1:3911/stream';

const engine = new Qwen3AsrEngine({
  sidecar: {
    baseUrl,
    wsUrl,
    isReady: async () => true,
  },
});

const wss = new WebSocketServer({ port, path: '/ws/voice' });
wss.on('connection', (ws) => {
  attachVoiceSocket(ws as any, {
    createSession: async () => new VoiceSession({
      asr: engine,
      send: (msg) => ws.send(JSON.stringify(msg)),
    }),
  });
});

wss.on('listening', () => {
  console.log(`[voice-bench] ws://127.0.0.1:${port}/ws/voice -> ${wsUrl}`);
});

const close = () => wss.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
