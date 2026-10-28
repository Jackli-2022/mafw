import { WebSocket } from 'ws';
import type {
  AsrEngine,
  AsrOptions,
  AsrResult,
  AsrStream,
} from '../../types';

export interface Qwen3AsrSidecarLike {
  baseUrl: string;
  wsUrl: string;
  isReady(): Promise<boolean>;
}

export interface Qwen3AsrEngineDeps {
  sidecar: Qwen3AsrSidecarLike;
  wsFactory?: (url: string) => WebSocket;
  fetchImpl?: typeof fetch;
}

interface SidecarPartial {
  type: 'partial';
  text: string;
}

interface SidecarFinal {
  type: 'final';
  text: string;
  language?: string;
  durationMs?: number;
}

interface SidecarError {
  type: 'error';
  message: string;
}

type SidecarMessage = SidecarPartial | SidecarFinal | SidecarError;

/**
 * Streaming adapter for the local Qwen3-ASR Python sidecar.
 *
 * Contract: send `start`, then binary PCM16 frames, then `end`; the sidecar
 * replies with partial/final JSON events. Calls made before the socket opens
 * are queued so callers can push audio immediately after createStream().
 */
export class Qwen3AsrEngine implements AsrEngine {
  readonly name = 'qwen3-asr-vllm';
  readonly capabilities = {
    streaming: 'native' as const,
    languages: ['zh', 'en'],
    punctuation: true,
    timestamps: 'none' as const,
    sampleRate: 16000,
  };

  private readonly sidecar: Qwen3AsrSidecarLike;
  private readonly wsFactory: (url: string) => WebSocket;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: Qwen3AsrEngineDeps) {
    this.sidecar = deps.sidecar;
    this.wsFactory = deps.wsFactory ?? ((url) => new WebSocket(url));
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async isAvailable(): Promise<{ ok: boolean; reason?: string }> {
    try {
      return (await this.sidecar.isReady())
        ? { ok: true }
        : { ok: false, reason: 'Qwen3-ASR sidecar is not healthy' };
    } catch (err: any) {
      return { ok: false, reason: err?.message || String(err) };
    }
  }

  createStream(opts: AsrOptions): AsrStream {
    const ws = this.wsFactory(this.sidecar.wsUrl);
    const pending: Buffer[] = [];
    let open = false;
    let ended = false;
    let settled = false;
    let partialCb: ((text: string) => void) | undefined;
    let latestPartial: string | undefined;
    let resolveFinal: ((r: AsrResult) => void) | undefined;
    let rejectFinal: ((e: Error) => void) | undefined;
    let finalResult: AsrResult | undefined;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      rejectFinal?.(err);
    };

    const resolve = (msg: SidecarFinal) => {
      if (settled) return;
      settled = true;
      finalResult = {
        text: msg.text,
        language: msg.language ?? opts.language,
        durationMs: msg.durationMs ?? 0,
        engine: this.name,
        final: true,
      };
      resolveFinal?.(finalResult);
      try { ws.close(); } catch { /* already closed */ }
    };

    const sendJson = (value: unknown) => {
      if (!open) return false;
      try {
        ws.send(JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    };

    const flush = () => {
      sendJson({ type: 'start', language: opts.language, sampleRate: opts.sampleRate });
      for (const frame of pending.splice(0)) {
        try { ws.send(frame); } catch { /* close handler reports */ }
      }
      if (ended) sendJson({ type: 'end' });
    };

    ws.on('open', () => {
      open = true;
      flush();
    });

    ws.on('message', (raw: any, isBinary: boolean) => {
      if (isBinary) return;
      let msg: SidecarMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'partial') {
        latestPartial = msg.text;
        partialCb?.(msg.text);
        return;
      }
      if (msg.type === 'final') {
        resolve(msg);
        return;
      }
      if (msg.type === 'error') {
        fail(new Error(msg.message || 'Qwen3-ASR sidecar error'));
      }
    });

    ws.on('error', (err: Error) => fail(err));
    ws.on('close', () => {
      if (!settled) fail(new Error('Qwen3-ASR sidecar socket closed before final'));
    });

    const endPromise = new Promise<AsrResult>((resolveEnd, rejectEnd) => {
      resolveFinal = resolveEnd;
      rejectFinal = rejectEnd;
    });

    return {
      push(pcm: Buffer) {
        if (settled || ended) return;
        if (!open) {
          pending.push(Buffer.from(pcm));
          return;
        }
        try { ws.send(pcm); } catch { /* close handler reports */ }
      },
      end() {
        if (finalResult) return Promise.resolve(finalResult);
        ended = true;
        if (open) sendJson({ type: 'end' });
        return endPromise;
      },
      abort() {
        if (settled) return;
        settled = true;
        if (open) sendJson({ type: 'abort' });
        try { ws.close(); } catch { /* already closed */ }
        rejectFinal?.(new Error('aborted'));
      },
      onPartial(cb: (text: string) => void) {
        partialCb = cb;
        if (latestPartial !== undefined) cb(latestPartial);
      },
    };
  }

  async transcribe(audio: Buffer, opts: AsrOptions): Promise<AsrResult> {
    const res = await this.fetchImpl(`${this.sidecar.baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_b64: audio.toString('base64'),
        language: opts.language,
        sampleRate: opts.sampleRate,
      }),
    } as any);
    if (!res.ok) throw new Error(`Qwen3-ASR transcribe failed: HTTP ${res.status}`);
    const body: any = await res.json();
    return {
      text: String(body?.text ?? ''),
      language: body?.language ?? opts.language,
      durationMs: Number(body?.durationMs ?? 0),
      engine: this.name,
      final: true,
    };
  }
}
