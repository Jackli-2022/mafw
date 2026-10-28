import type { VoiceEngineTier } from './types';

export type VoiceModelKind = 'asr' | 'tts';
export type VoiceLicense =
  | 'Apache-2.0'
  | 'MIT'
  | 'BSD-2-Clause'
  | 'user-plugin';

export interface VoiceModelFile {
  url: string;
  sha256: string;
  path: string;
}

export interface VoiceModelEntry {
  id: string;
  kind: VoiceModelKind;
  tier: VoiceEngineTier;
  engine: string;
  languages: string[];
  license: VoiceLicense;
  sizeBytes: number;
  files: VoiceModelFile[];
  requires?: { ramGb?: number; vramGb?: number };
  capabilities: Record<string, unknown>;
}

/**
 * Local model catalogue. This is intentionally data-only: the model manager
 * (later phase) downloads/verifies/loads entries; the voice runtime only needs
 * stable ids and honest capability metadata.
 *
 * `sha256` is deliberately empty for now; the model manager fills and verifies
 * checksums before any download is exposed to users.
 */
export const VOICE_MODELS: readonly VoiceModelEntry[] = [
  {
    id: 'qwen3-asr-1.7b-vllm',
    kind: 'asr',
    tier: 'dgpu',
    engine: 'qwen3-asr-vllm',
    languages: ['zh', 'en'],
    license: 'Apache-2.0',
    sizeBytes: 4_400_000_000,
    files: [
      {
        url: 'https://huggingface.co/Qwen/Qwen3-ASR-1.7B',
        sha256: '',
        path: 'qwen3-asr-1.7b',
      },
    ],
    requires: { vramGb: 8, ramGb: 16 },
    capabilities: {
      streaming: 'native',
      punctuation: true,
      timestamps: 'none',
      sampleRate: 16000,
    },
  },
  {
    id: 'qwen3-asr-0.6b',
    kind: 'asr',
    tier: 'igpu',
    engine: 'sherpa-qwen3-asr',
    languages: ['zh', 'en'],
    license: 'Apache-2.0',
    sizeBytes: 940_000_000,
    files: [
      {
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
        sha256: '',
        path: 'qwen3-asr-0.6b',
      },
    ],
    requires: { ramGb: 4 },
    capabilities: {
      streaming: 'none',
      punctuation: true,
      timestamps: 'none',
      sampleRate: 16000,
    },
  },
  {
    id: 'sherpa-zipformer-bilingual-zh-en',
    kind: 'asr',
    tier: 'igpu',
    engine: 'sherpa-zipformer',
    languages: ['zh', 'en'],
    license: 'Apache-2.0',
    sizeBytes: 200_000_000,
    files: [
      {
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2',
        sha256: '',
        path: 'zipformer-bilingual-zh-en',
      },
    ],
    requires: { ramGb: 2 },
    capabilities: {
      streaming: 'native',
      punctuation: true,
      timestamps: 'none',
      sampleRate: 16000,
    },
  },
  {
    id: 'cosyvoice3-0.5b',
    kind: 'tts',
    tier: 'dgpu',
    engine: 'cosyvoice3',
    languages: ['zh', 'en'],
    license: 'Apache-2.0',
    sizeBytes: 3_400_000_000,
    files: [
      {
        url: 'https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
        sha256: '',
        path: 'cosyvoice3-0.5b',
      },
    ],
    requires: { vramGb: 6, ramGb: 16 },
    capabilities: {
      streaming: 'native',
      voiceCloning: true,
      styleControl: true,
      sampleRate: 24000,
    },
  },
  {
    id: 'qwen3-tts-0.6b',
    kind: 'tts',
    tier: 'dgpu',
    engine: 'qwen3-tts',
    languages: ['zh', 'en'],
    license: 'Apache-2.0',
    sizeBytes: 1_800_000_000,
    files: [
      {
        url: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        sha256: '',
        path: 'qwen3-tts-0.6b',
      },
    ],
    requires: { vramGb: 4, ramGb: 16 },
    capabilities: {
      streaming: 'native',
      voiceCloning: true,
      styleControl: true,
      sampleRate: 24000,
    },
  },
  {
    id: 'kokoro-zh-en',
    kind: 'tts',
    tier: 'igpu',
    engine: 'sherpa-kokoro',
    languages: ['zh', 'en'],
    license: 'Apache-2.0',
    sizeBytes: 311_000_000,
    files: [
      {
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
        sha256: '',
        path: 'kokoro-zh-en',
      },
    ],
    requires: { ramGb: 4 },
    capabilities: {
      streaming: 'sentence',
      voiceCloning: false,
      styleControl: false,
      sampleRate: 24000,
    },
  },
  {
    id: 'melo-zh-en',
    kind: 'tts',
    tier: 'igpu',
    engine: 'sherpa-melo',
    languages: ['zh', 'en'],
    license: 'MIT',
    sizeBytes: 163_000_000,
    files: [
      {
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2',
        sha256: '',
        path: 'melo-zh-en',
      },
    ],
    requires: { ramGb: 2 },
    capabilities: {
      streaming: 'sentence',
      voiceCloning: false,
      styleControl: false,
      sampleRate: 44100,
    },
  },
];

const BUILTIN_LICENSES: readonly VoiceLicense[] = [
  'Apache-2.0',
  'MIT',
  'BSD-2-Clause',
];

export function findVoiceModel(id: string): VoiceModelEntry | undefined {
  return VOICE_MODELS.find((m) => m.id === id);
}

export function voiceModelsFor(
  kind: VoiceModelKind,
  tier?: VoiceEngineTier,
): VoiceModelEntry[] {
  return VOICE_MODELS.filter(
    (m) => m.kind === kind && (tier === undefined || m.tier === tier),
  );
}

export function assertBuiltinLicense(model: VoiceModelEntry): void {
  if (!BUILTIN_LICENSES.includes(model.license)) {
    throw new Error(
      `model ${model.id} uses ${model.license} license; accept it before use`,
    );
  }
}
