import type { AsrEngine } from '../../../src/voice/types';

/**
 * Test-package ASR engine. Registered through `registerAsrEngine(..., 'package')`
 * by the G2 test; no gateway core file changes are involved.
 */
export function createFakeAsrEngine(name: string, over: Partial<AsrEngine> = {}): AsrEngine {
  return {
    name,
    capabilities: {
      streaming: 'native',
      languages: ['zh', 'en'],
      punctuation: true,
      timestamps: 'none',
      sampleRate: 16000,
    },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({
      push: () => {},
      end: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
      abort: () => {},
      onPartial: () => {},
    }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
    ...over,
  };
}
