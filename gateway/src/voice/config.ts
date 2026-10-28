import * as os from 'os';
import * as path from 'path';
import type { VoiceTier } from './types';

export interface VoiceConfig {
  tier: VoiceTier;
  localTier: 'dgpu' | 'igpu';
  /** Catalogue model id, not an engine id. VoiceRuntime maps it to an engine. */
  asrEngine: string;
  /** Catalogue model id, not an engine id. */
  ttsEngine: string;
  cloudConsent: boolean;
  modelsDir: string;
  sidecarPort: number;
}

const DEFAULT_MODELS_DIR = path.join(os.homedir(), '.mafw', 'models', 'voice');

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  tier: 'auto',
  localTier: 'dgpu',
  asrEngine: 'qwen3-asr-1.7b-vllm',
  ttsEngine: 'cosyvoice3-0.5b',
  cloudConsent: false,
  modelsDir: DEFAULT_MODELS_DIR,
  sidecarPort: 3911,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  }
  return fallback;
}

function port(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export function resolveVoiceConfig(
  raw: any,
  env: Record<string, string | undefined> = process.env,
): VoiceConfig {
  const fromRaw = raw && typeof raw === 'object' && raw.voice && typeof raw.voice === 'object'
    ? raw.voice
    : {};

  const tier = oneOf(
    env.MAFW_VOICE_TIER ?? fromRaw.tier,
    ['auto', 'local', 'cloud'] as const,
    'auto',
  );
  const localTier = oneOf(
    env.MAFW_VOICE_LOCAL_TIER ?? fromRaw.localTier,
    ['dgpu', 'igpu'] as const,
    'dgpu',
  );
  const asrEngine = String(
    env.MAFW_VOICE_ASR_ENGINE ?? fromRaw.asrEngine ?? DEFAULT_VOICE_CONFIG.asrEngine,
  ).trim() || DEFAULT_VOICE_CONFIG.asrEngine;
  const ttsEngine = String(
    env.MAFW_VOICE_TTS_ENGINE ?? fromRaw.ttsEngine ?? DEFAULT_VOICE_CONFIG.ttsEngine,
  ).trim() || DEFAULT_VOICE_CONFIG.ttsEngine;
  const cloudConsent = bool(
    env.MAFW_VOICE_CLOUD_CONSENT ?? fromRaw.cloudConsent,
    DEFAULT_VOICE_CONFIG.cloudConsent,
  );
  const modelsDir = String(fromRaw.modelsDir ?? DEFAULT_VOICE_CONFIG.modelsDir).trim()
    || DEFAULT_VOICE_CONFIG.modelsDir;
  const sidecarPort = port(
    env.MAFW_VOICE_SIDECAR_PORT ?? fromRaw.sidecarPort,
    DEFAULT_VOICE_CONFIG.sidecarPort,
  );

  return { tier, localTier, asrEngine, ttsEngine, cloudConsent, modelsDir, sidecarPort };
}
