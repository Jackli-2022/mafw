import { createTtsService, TTS_VOICES } from '../media/tts-service';
import type { PcmChunk, TtsEngine, TtsOpts } from './types';

/**
 * mimo 内置引擎：MiMo-V2.5-TTS（云，小米 OpenAI 兼容端点）。
 * 行为与原 tts-service 完全一致，仅适配 TtsEngine 接口。
 */
export function createMimoEngine(deps: {
  provider?: string;
  config: () => { media?: { tts?: { baseUrl?: string; model?: string; defaultVoice?: string }; provider?: string } };
  fetchImpl?: typeof fetch;
  /** 凭据 seam（Plan 3 Task 5）：注入式 getApiKey（auth.json 解析在 index.ts 单点接线）。 */
  getApiKey?: (provider: string) => string | null;
}): TtsEngine {
  const svc = createTtsService(deps);
  return {
    name: 'mimo',
    capabilities: {
      streaming: 'native',
      voiceCloning: true, // mimo-v2.5-tts-voiceclone 模型存在；refAudio 适配后续做
      styleControl: true,
      languages: ['zh', 'en'],
      sampleRate: 24000,
    },
    voices: () => TTS_VOICES,
    async *synthesizeStream(text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk> {
      const gen = svc.synthesizeStream({ text, voice: opts.voice, style: opts.style }, { signal });
      for await (const chunk of gen) {
        if (signal.aborted) return;
        yield { pcm: Buffer.from(chunk.data, 'base64'), sampleRate: 24000 };
      }
    },
    async synthesize(text: string, opts: TtsOpts): Promise<Buffer> {
      const r = await svc.synthesize({ text, voice: opts.voice, style: opts.style });
      const b64 = r.audioDataUrl.split(',')[1] || '';
      return Buffer.from(b64, 'base64');
    },
  };
}
