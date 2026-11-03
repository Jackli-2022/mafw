import type {
  AsrEngine,
  AsrStream,
  VoiceTier,
} from './types';
import type {
  VoiceClientMessage,
  VoiceRouting,
  VoiceServerMessage,
} from './transport/protocol';
import { supportsLanguage } from './types';

export type VoiceSessionState = 'idle' | 'listening' | 'processing' | 'closed';

export interface VoiceSessionDeps {
  asr: AsrEngine;
  send: (msg: VoiceServerMessage) => void;
  /**
   * Routing actually in effect for this session. Required on purpose: the
   * session must report what the runtime resolved, never a hardcoded status.
   */
  routing: VoiceRouting;
  now?: () => number;
  /** Deadline for one ASR final; a wedged sidecar must not hang the session. */
  turnTimeoutMs?: number;
}

/**
 * ASR-only continuous session. P1 deliberately stops after `asr.final`; the
 * TTS/LLM loop is P2. The state machine is still the one the full runtime will
 * use, so the transport and desktop can be wired once.
 */
export class VoiceSession {
  private _state: VoiceSessionState = 'idle';
  private stream?: AsrStream;
  private voiceSessionId?: string;
  private _chatSessionId?: string;
  private language?: string;
  private bytesPushed = 0;
  private generation = 0;
  private turnSeq = 0;

  constructor(private readonly deps: VoiceSessionDeps) {}

  get state(): VoiceSessionState {
    return this._state;
  }

  /**
   * Target chat session announced in `hello`. Plan 1 only retains it: no chat
   * session is created, resumed or otherwise touched until the duplex slices.
   */
  get chatSessionId(): string | undefined {
    return this._chatSessionId;
  }

  private send(msg: VoiceServerMessage): void {
    this.deps.send(msg);
  }

  private isClosed(): boolean {
    return this._state === 'closed';
  }

  private startStream(): void {
    if (!this.voiceSessionId) return;
    const generation = ++this.generation;
    const stream = this.deps.asr.createStream({
      sessionId: this.voiceSessionId,
      language: this.language,
      sampleRate: this.deps.asr.capabilities.sampleRate,
    });
    this.stream = stream;
    this.bytesPushed = 0;
    stream.onPartial((text) => {
      if (generation !== this.generation || this._state === 'closed') return;
      this.send({ type: 'asr.partial', text });
    });
  }

  async handleControl(msg: VoiceClientMessage): Promise<void> {
    switch (msg.type) {
      case 'hello': {
        if (this._state !== 'idle') {
          this.send({ type: 'error', code: 'already_started', message: 'session already started', recoverable: false });
          return;
        }
        // v1 gates. All of them run before createStream(), so a rejected hello
        // never opens an ASR stream. This is the whole invariant: it says
        // nothing about sidecar startup, which the transport already triggered
        // by creating this session through getVoiceRuntime() before
        // handleControl() was reached.
        if (!msg.clientVad) {
          this.send({ type: 'error', code: 'client_vad_required', message: 'v1 requires client VAD', recoverable: false });
          return;
        }
        if (msg.tier === 'cloud') {
          this.send({ type: 'error', code: 'cloud_not_implemented', message: 'cloud voice is not implemented', recoverable: false });
          return;
        }
        if (!supportsLanguage(this.deps.asr.capabilities, msg.language)) {
          this.send({
            type: 'error',
            code: 'language_unsupported',
            message: `engine ${this.deps.asr.name} does not support language ${msg.language}`,
            recoverable: false,
          });
          return;
        }
        this.voiceSessionId = msg.voiceSessionId;
        this._chatSessionId = msg.chatSessionId;
        this.language = msg.language;
        this.startStream();
        this._state = 'listening';
        this.send({
          type: 'ready',
          routing: this.deps.routing,
          asr: {
            engine: this.deps.asr.name,
            streaming: this.deps.asr.capabilities.streaming,
          },
          tts: null,
        });
        return;
      }
      case 'config': {
        // v1 cannot serve cloud, so a mid-session cloud request must be
        // rejected instead of quietly continuing on the local path.
        if (msg.tier === 'cloud') {
          this.send({ type: 'error', code: 'cloud_not_implemented', message: 'cloud voice is not implemented', recoverable: false });
          this.close();
          return;
        }
        if (msg.language !== undefined) {
          if (!supportsLanguage(this.deps.asr.capabilities, msg.language)) {
            this.send({
              type: 'error',
              code: 'language_unsupported',
              message: `engine ${this.deps.asr.name} does not support language ${msg.language}`,
              recoverable: false,
            });
            return;
          }
          this.language = msg.language;
        }
        return;
      }
      case 'end_audio': {
        if (this._state === 'idle' || this._state === 'closed') {
          this.send({ type: 'error', code: 'hello_required', message: 'send hello first', recoverable: false });
          return;
        }
        if (this._state === 'processing') {
          this.send({ type: 'error', code: 'turn_busy', message: 'a turn is already being finalized', recoverable: true });
          return;
        }
        if (this._state !== 'listening') return;
        if (this.bytesPushed === 0) {
          this.send({ type: 'error', code: 'empty_audio', message: 'no audio received for this turn', recoverable: true });
          return;
        }
        this._state = 'processing';
        const generation = this.generation;
        const stream = this.stream;
        // Keep this.stream pointing at the in-flight stream so cancel() can
        // abort it; the generation check below suppresses its late final.
        let result;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutMs = this.deps.turnTimeoutMs ?? 15_000;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('asr_timeout')), timeoutMs);
        });
        try {
          result = await Promise.race([
            stream?.end() ?? Promise.resolve(undefined),
            timeout,
          ]);
        } catch (err: any) {
          const timedOut = err?.message === 'asr_timeout';
          if (!timedOut && (generation !== this.generation || this.isClosed())) return;
          this.generation++;
          stream?.abort();
          this.stream = undefined;
          this.bytesPushed = 0;
          this._state = 'listening';
          this.send({
            type: 'error',
            code: timedOut ? 'asr_timeout' : 'asr_failed',
            message: err?.message || String(err),
            recoverable: true,
          });
          this.startStream();
          return;
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (generation !== this.generation || this.isClosed()) return;
        this.send({ type: 'asr.final', ...(result ?? {
          text: '', durationMs: 0, engine: this.deps.asr.name, final: true,
        }) });
        this.send({ type: 'turn.done', turnId: `turn-${++this.turnSeq}` });
        this._state = 'listening';
        this.startStream();
        return;
      }
      case 'cancel': {
        if (this._state === 'idle' || this._state === 'closed') return;
        this.generation++;
        this.stream?.abort();
        this.stream = undefined;
        this.bytesPushed = 0;
        this._state = 'listening';
        this.send({ type: 'turn.cancelled', reason: 'client_cancel' });
        this.startStream();
        return;
      }
      case 'stop': {
        this.close();
        return;
      }
      case 'vad.speech_started':
      case 'vad.speech_stopped':
        // P2 owns turn-taking; P1 relies on the client's explicit end_audio.
        return;
    }
  }

  handleAudio(pcm: Buffer): void {
    if (this._state === 'idle' || this._state === 'closed') {
      this.send({ type: 'error', code: 'hello_required', message: 'send hello first', recoverable: false });
      return;
    }
    if (this._state !== 'listening' || !this.stream) return;
    this.bytesPushed += pcm.byteLength;
    this.stream.push(pcm);
  }

  close(): void {
    if (this._state === 'closed') return;
    this.generation++;
    this.stream?.abort();
    this.stream = undefined;
    this._state = 'closed';
  }
}
