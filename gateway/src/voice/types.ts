/**
 * Voice Runtime v2 — shared contracts.
 *
 * These types are intentionally independent of the existing `src/tts/` legacy
 * pipeline; the voice runtime wraps legacy engines rather than changing their
 * public contract.
 */

export type VoiceTier = 'auto' | 'local' | 'cloud';
export type VoiceEngineTier = 'dgpu' | 'igpu' | 'cloud';

export type RoutingStatus =
  | 'local_accelerated'
  | 'local_cpu'
  | 'cloud'
  | 'degraded';

export interface AsrCapabilities {
  /** native = true incremental partials; none = VAD-segmented/offline. */
  streaming: 'native' | 'none';
  /** Engine-declared languages; `multi` means open-ended. */
  languages: string[];
  punctuation: boolean;
  timestamps: 'word' | 'segment' | 'none';
  /** Input sample rate the engine expects. */
  sampleRate: number;
  maxAudioSeconds?: number;
}

export interface AsrWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface AsrResult {
  text: string;
  language?: string;
  words?: AsrWord[];
  confidence?: number;
  durationMs: number;
  engine: string;
  final: boolean;
}

export interface AsrOptions {
  sessionId: string;
  language?: string;
  sampleRate: number;
  signal?: AbortSignal;
}

export interface AsrStream {
  push(pcm: Buffer): void;
  end(): Promise<AsrResult>;
  abort(): void;
  onPartial(cb: (text: string) => void): void;
}

export interface AsrEngine {
  name: string;
  capabilities: AsrCapabilities;
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  createStream(opts: AsrOptions): AsrStream;
  transcribe(audio: Buffer, opts: AsrOptions): Promise<AsrResult>;
}

export function assertAsrCapabilities(caps: AsrCapabilities): void {
  if (!caps) throw new Error('AsrCapabilities is required');
  if (!Number.isFinite(caps.sampleRate) || caps.sampleRate <= 0) {
    throw new Error('AsrCapabilities.sampleRate must be > 0');
  }
  if (!Array.isArray(caps.languages) || caps.languages.length === 0) {
    throw new Error('AsrCapabilities.languages must not be empty');
  }
  if (caps.streaming !== 'native' && caps.streaming !== 'none') {
    throw new Error(`AsrCapabilities.streaming is invalid: ${String(caps.streaming)}`);
  }
  if (!['word', 'segment', 'none'].includes(caps.timestamps)) {
    throw new Error(`AsrCapabilities.timestamps is invalid: ${String(caps.timestamps)}`);
  }
}

export function supportsLanguage(
  caps: { languages: string[] },
  language?: string,
): boolean {
  if (!language) return true;
  const value = language.trim().toLowerCase();
  if (!value || value === 'auto') return true;
  const supported = caps.languages.map((l) => l.trim().toLowerCase());
  if (supported.includes('multi')) return true;
  const base = value.replace('_', '-').split('-', 1)[0];
  return supported.some((l) => {
    const supportedBase = l.replace('_', '-').split('-', 1)[0];
    return l === value || supportedBase === base;
  });
}
