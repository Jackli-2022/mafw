import type { AsrResult, RoutingStatus, VoiceTier } from '../types';

export interface VoiceHelloMessage {
  type: 'hello';
  sessionId: string;
  mode: 'continuous';
  tier: VoiceTier;
  language?: string;
  voice?: string;
  format: 'pcm16';
  clientVad: boolean;
}

export interface VoiceConfigMessage {
  type: 'config';
  tier?: VoiceTier;
  voice?: string;
  language?: string;
}

export type VoiceClientMessage =
  | VoiceHelloMessage
  | VoiceConfigMessage
  | { type: 'vad.speech_started' }
  | { type: 'vad.speech_stopped' }
  | { type: 'end_audio' }
  | { type: 'cancel' }
  | { type: 'stop' };

export interface VoiceRouting {
  status: RoutingStatus;
  reason?: string;
}

export type VoiceServerMessage =
  | {
      type: 'ready';
      routing: VoiceRouting;
      asr: { engine: string; streaming: 'native' | 'none' };
      tts: null | { engine: string; sampleRate: number };
    }
  | { type: 'asr.partial'; text: string }
  | ({ type: 'asr.final' } & AsrResult)
  | { type: 'routing'; status: RoutingStatus; reason?: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'turn.cancelled'; reason?: string }
  | { type: 'turn.done'; turnId?: string };

const TIERS: readonly VoiceTier[] = ['auto', 'local', 'cloud'];

function invalid(reason: string): never {
  throw new Error(`invalid_voice_message: ${reason}`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalid(`${field} must be a string`);
  return value;
}

function requireTier(value: unknown, field: string): VoiceTier {
  if (typeof value !== 'string' || !TIERS.includes(value as VoiceTier)) {
    invalid(`${field} must be one of ${TIERS.join('|')}`);
  }
  return value as VoiceTier;
}

export function parseClientMessage(raw: string): VoiceClientMessage {
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid('not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('message must be an object');
  }

  switch (value.type) {
    case 'hello': {
      const sessionId = requireString(value.sessionId, 'sessionId');
      const tier = requireTier(value.tier, 'tier');
      if (value.mode !== 'continuous') invalid('mode must be continuous');
      if (value.format !== 'pcm16') invalid('format must be pcm16');
      if (typeof value.clientVad !== 'boolean') invalid('clientVad must be boolean');
      return {
        type: 'hello',
        sessionId,
        mode: 'continuous',
        tier,
        language: optionalString(value.language, 'language'),
        voice: optionalString(value.voice, 'voice'),
        format: 'pcm16',
        clientVad: value.clientVad,
      };
    }
    case 'config': {
      return {
        type: 'config',
        tier: value.tier === undefined ? undefined : requireTier(value.tier, 'tier'),
        voice: optionalString(value.voice, 'voice'),
        language: optionalString(value.language, 'language'),
      };
    }
    case 'vad.speech_started':
    case 'vad.speech_stopped':
    case 'end_audio':
    case 'cancel':
    case 'stop':
      return { type: value.type };
    default:
      invalid(`unknown type: ${String(value.type)}`);
  }
}

export function serverError(
  code: string,
  message: string,
  recoverable = false,
): VoiceServerMessage {
  return { type: 'error', code, message, recoverable };
}
