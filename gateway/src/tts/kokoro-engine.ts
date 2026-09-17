import * as path from 'path';
import { log } from '../core/utils/logger';
import type { PcmChunk, TtsEngine, TtsOpts, TtsVoice } from './types';

/**
 * kokoro 内置引擎：Kokoro-82M（Apache 2.0 含权重），kokoro-js + transformers.js
 * 进程内 ONNX Runtime。定位：离线兜底（CPU 可跑，中文音色一般）。
 *
 * - kokoro-js 是 ESM-only，gateway 是 CJS → 用 pi-adapter 同款 ESM 桥
 *   （new Function('spec','return import(spec)')），直接 import() 会被 tsc 降级
 *   为 require 而抛错。
 * - 模型 ~90MB（onnx-community/Kokoro-82M-v1.0-ONNX，q8）首次使用时下载到
 *   modelsDir（~/.mafw/models/kokoro），HF_ENDPOINT 环境变量可切镜像。
 * - streaming='none'：整段合成后由句切分适配层统一流式语义。
 * - 模块加载失败可重试（promise 缓存仅在成功后固化）。
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * v1.0 音色集（kokoro-js 1.2.1 硬编码校验，无中文 zf_/zm_——v1.1-zh 不被支持）。
 * 定位：英文离线兜底；中文离线兜底待 sherpa-onnx VITS-zh / MeloTTS sidecar（§8 后续方向）。
 */
const KOKORO_VOICES: TtsVoice[] = [
  { id: 'af_heart', label: 'Heart (EN female)', lang: 'en' },
  { id: 'af_nova', label: 'Nova (EN female)', lang: 'en' },
  { id: 'am_michael', label: 'Michael (EN male)', lang: 'en' },
  { id: 'am_fenrir', label: 'Fenrir (EN male)', lang: 'en' },
];

const DEFAULT_VOICE = 'af_heart';

export function createKokoroEngine(deps: {
  modelsDir: string;
  /** 测试注入点；生产走 ESM 桥动态 import('kokoro-js') */
  loadModule?: () => Promise<any>;
}): TtsEngine {
  let ttsPromise: Promise<any> | null = null;

  const importEsm = (spec: string): Promise<any> => {
    const fn = new Function('spec', 'return import(spec)') as (s: string) => Promise<any>;
    return fn(spec);
  };

  async function ensureTts(): Promise<any> {
    if (!ttsPromise) {
      ttsPromise = (async () => {
        let mod: any;
        try {
          mod = await (deps.loadModule ? deps.loadModule() : importEsm('kokoro-js'));
        } catch (err: any) {
          throw new Error(
            `kokoro-js 未安装或加载失败：${err.message}。` +
            `离线兜底引擎需要 optional dependency：cd gateway && npm i kokoro-js`,
          );
        }
        log.info('[TTS] loading kokoro model (first use downloads ~90MB; slow network → set HF_ENDPOINT=https://hf-mirror.com for mirror)');
        const lastPct = { v: 0 };
        const tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          cache_dir: path.join(deps.modelsDir, 'kokoro'),
          progress_callback: (p: any) => {
            if (p?.status === 'progress' && typeof p.progress === 'number') {
              const pct = Math.floor(p.progress);
              if (pct >= lastPct.v + 25) { lastPct.v = pct; log.info(`[TTS] kokoro model download: ${pct}%`); }
            }
          },
        }).catch((err: any) => {
          throw new Error(`kokoro 模型加载失败（${err?.message ?? String(err)}）。首次使用需下载 ~90MB 模型；网络不通时设置环境变量 HF_ENDPOINT=https://hf-mirror.com 走镜像后重启 gateway`);
        });
        log.info('[TTS] kokoro model ready');
        return tts;
      })();
      // 失败可重试：清掉缓存的 rejected promise
      ttsPromise.catch(() => { ttsPromise = null; });
    }
    return ttsPromise;
  }

  return {
    name: 'kokoro',
    capabilities: {
      streaming: 'none',
      voiceCloning: false,
      styleControl: false,
      languages: ['zh', 'en', 'ja'],
      sampleRate: 24000,
    },
    voices: () => KOKORO_VOICES,
    async synthesize(text: string, opts: TtsOpts): Promise<Buffer> {
      const tts = await ensureTts();
      const voice = opts.voice && KOKORO_VOICES.some(v => v.id === opts.voice) ? opts.voice : DEFAULT_VOICE;
      const audio = await tts.generate(text, { voice });
      // kokoro-js RawAudio：{ audio: Float32Array, sampling_rate }；新版可能带 toWav()
      if (typeof audio.toWav === 'function') return Buffer.from(audio.toWav());
      return float32ToWav(audio.audio, audio.sampling_rate ?? 24000);
    },
    async *synthesizeStream(): AsyncIterable<PcmChunk> {
      throw new Error('kokoro engine does not support native streaming (use sentence adapter)');
    },
  };
}

/** Float32 PCM → 16-bit RIFF/WAVE（mono）。 */
function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(s * (s < 0 ? 0x8000 : 0x7fff)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
