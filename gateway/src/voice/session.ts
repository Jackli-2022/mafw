import type {
  AsrEngine,
  AsrStream,
  VoiceTier,
} from './types';
import type {
  VoiceClientMessage,
  VoiceServerMessage,
} from './transport/protocol';
import { supportsLanguage } from './types';

export type VoiceSessionState = 'idle' | 'listening' | 'processing' | 'closed';

export interface VoiceSessionDeps {
  asr: AsrEngine;
  send: (msg: VoiceServerMessage) => void;
  now?: () => number;
}

/**
 * ASR-only continuous session. P1 deliberately stops after `asr.final`; the
 * TTS/LLM loop is P2. The state machine is still the one the full runtime will
 * use, so the transport and desktop can be wired once.
 */
export class VoiceSession {
  private _state: VoiceSessionState = 'idle';
  private stream?: AsrStream;
  private sessionId?: string;
  private language?: string;
  private bytesPushed = 0;
  private generation = 0;
  private turnSeq = 0;

  constructor(private readonly deps: VoiceSessionDeps) {}

  get state(): VoiceSessionState {
    return this._state;
  }

  private send(msg: VoiceServerMessage): void {
    this.deps.send(msg);
  }

  private isClosed(): boolean {
    return this._state === 'closed';
  }

  private startStream(): void {
    if (!this.sessionId) return;
    const generation = ++this.generation;
    const stream = this.deps.asr.createStream({
      sessionId: this.sessionId,
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
        if (!supportsLanguage(this.deps.asr.capabilities, msg.language)) {
          this.send({
            type: 'error',
            code: 'language_unsupported',
            message: `engine ${this.deps.asr.name} does not support language ${msg.language}`,
            recoverable: false,
          });
          return;
        }
        this.sessionId = msg.sessionId;
        this.language = msg.language;
        this.startStream();
        this._state = 'listening';
        this.send({
          type: 'ready',
          routing: { status: 'local_accelerated' },
          asr: {
            engine: this.deps.asr.name,
            streaming: this.deps.asr.capabilities.streaming,
          },
          tts: null,
        });
        return;
      }
      case 'config': {
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
        try {
          result = await stream?.end();
        } catch (err: any) {
          if (generation !== this.generation || this.isClosed()) return;
          this._state = 'listening';
          this.send({
            type: 'error',
            code: 'asr_failed',
            message: err?.message || String(err),
            recoverable: true,
          });
          this.startStream();
          return;
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
