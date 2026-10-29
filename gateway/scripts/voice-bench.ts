import * as fs from 'fs';
import * as path from 'path';
import { WebSocket } from 'ws';

export interface BenchSample {
  fixture?: string;
  firstPartialMs?: number;
  finalMs?: number;
  text: string;
  /** Debug: wall time until the first 160 ms of audio was handed to the socket. */
  audio160Ms?: number;
}

export interface BenchSummary {
  count: number;
  firstPartialP50: number;
  firstPartialP95: number;
  finalP50: number;
  finalP95: number;
  maxFirstPartialMs: number;
  maxFinalMs: number;
  empty: number;
}

function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.5)];
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

export function summarizeBench(samples: BenchSample[]): BenchSummary {
  const first = samples.map((s) => s.firstPartialMs).filter((n): n is number => Number.isFinite(n));
  const final = samples.map((s) => s.finalMs).filter((n): n is number => Number.isFinite(n));
  return {
    count: samples.length,
    firstPartialP50: p50(first),
    firstPartialP95: p95(first),
    finalP50: p50(final),
    finalP95: p95(final),
    maxFirstPartialMs: first.length ? Math.max(...first) : 0,
    maxFinalMs: final.length ? Math.max(...final) : 0,
    empty: samples.filter((s) => !s.text.trim()).length,
  };
}

/** Parse a 16 kHz mono PCM16 RIFF/WAVE file and return raw PCM bytes. */
export function loadWavPcm16(file: string): Buffer {
  const buf = fs.readFileSync(file);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${file}`);
  }
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, Math.min(buf.length, offset + 8 + size));
    if (id === 'fmt ' && body.length >= 16) {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === 'data') {
      data = Buffer.from(body);
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`missing fmt/data chunk: ${file}`);
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 16000 || fmt.bits !== 16) {
    throw new Error(
      `need 16 kHz mono PCM16 WAV, got format=${fmt.format} channels=${fmt.channels} rate=${fmt.sampleRate} bits=${fmt.bits}`,
    );
  }
  return data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOnce(url: string, pcm: Buffer): Promise<BenchSample> {
  return new Promise<BenchSample>((resolve, reject) => {
    const ws = new WebSocket(url);
    let firstAudioAt: number | undefined;
    let audio160At: number | undefined;
    let firstPartialMs: number | undefined;
    let endAt: number | undefined;
    let finalAt: number | undefined;
    let text = '';
    let settled = false;
    let sending = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve({
        firstPartialMs,
        finalMs: finalAt !== undefined && endAt !== undefined ? finalAt - endAt : undefined,
        text,
        audio160Ms: audio160At,
      });
    };

    const sendAudio = async () => {
      if (sending) return;
      sending = true;
      let sentBytes = 0;
      const audioStart = Date.now();
      let frame = 0;
      try {
        for (let offset = 0; offset < pcm.length; offset += 640, frame += 1) {
          const target = audioStart + frame * 20;
          const wait = target - Date.now();
          if (wait > 0) await delay(wait);
          if (firstAudioAt === undefined) firstAudioAt = Date.now();
          const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + 640));
          ws.send(chunk);
          sentBytes += chunk.length;
          if (audio160At === undefined && sentBytes >= 5120 && firstAudioAt !== undefined) {
            audio160At = Date.now() - firstAudioAt;
          }
        }
        endAt = Date.now();
        ws.send(JSON.stringify({ type: 'end_audio' }));
      } catch (err: any) {
        finish(err);
      }
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'hello', sessionId: `bench-${Date.now()}`, mode: 'continuous',
        tier: 'local', language: 'zh', format: 'pcm16', clientVad: true,
      }));
    });

    ws.on('message', (raw: any, isBinary: boolean) => {
      if (isBinary) return;
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'ready') {
        void sendAudio();
      } else if (msg.type === 'asr.partial' && firstPartialMs === undefined && msg.text) {
        firstPartialMs = firstAudioAt === undefined ? undefined : Date.now() - firstAudioAt;
      } else if (msg.type === 'asr.final') {
        finalAt = Date.now();
        text = String(msg.text ?? '');
        finish();
      } else if (msg.type === 'error') {
        finish(new Error(`${msg.code}: ${msg.message}`));
      }
    });

    ws.on('error', (err: Error) => finish(err));
    ws.on('close', () => {
      if (!settled) finish(new Error('socket closed before asr.final'));
    });
  });
}

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

async function main(): Promise<void> {
  const url = arg('url', 'ws://127.0.0.1:3000/ws/voice')!;
  const wav = arg('wav');
  const dir = arg('dir');
  if (!wav && !dir) {
    throw new Error('usage: voice-bench (--wav <16k-mono-pcm16.wav> | --dir <fixtures>) [--url ws://...] [--repeat 3]');
  }
  const repeat = Number(arg('repeat', '3'));
  const files = dir
    ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).sort().map((f) => path.join(dir, f))
    : [wav!];
  const samples: BenchSample[] = [];
  for (const file of files) {
    const pcm = loadWavPcm16(file);
    for (let i = 0; i < repeat; i += 1) {
      const sample = await runOnce(url, pcm);
      samples.push({ ...sample, fixture: path.basename(file) });
    }
  }
  const report = { summary: summarizeBench(samples), samples };
  const out = arg('out');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.message || String(err));
    process.exit(1);
  });
}
