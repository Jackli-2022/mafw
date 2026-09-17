import type { PcmChunk, TtsEngine, TtsOpts } from './types';

const SENTENCE_RE = /[^。！？!?\.…\n]+[。！？!?\.…]*\s*/g;
const DEFAULT_MAX_LEN = 100;

/** 中英文句切分：按标点切，超长句按 maxLen 硬切。 */
export function splitSentences(text: string, maxLen = DEFAULT_MAX_LEN): string[] {
  const out: string[] = [];
  const matches = text.match(SENTENCE_RE) ?? [];
  for (const raw of matches) {
    let s = raw.trim();
    while (s.length > maxLen) {
      out.push(s.slice(0, maxLen));
      s = s.slice(maxLen);
    }
    if (s) out.push(s);
  }
  return out;
}

/** 剥 RIFF 头取 PCM 体（wav 标准 44 字节头）。 */
function wavToPcm(wav: Buffer): Buffer {
  if (wav.length > 44 && wav.toString('ascii', 0, 4) === 'RIFF') {
    return wav.subarray(44);
  }
  return wav;
}

/**
 * 伪流式适配：streaming='none' 的引擎按句 synthesize 后立即 yield，
 * 对外统一 AsyncIterable<PcmChunk> 流式语义。
 */
export async function* adaptToStream(
  engine: TtsEngine,
  text: string,
  opts: TtsOpts,
  signal: AbortSignal,
): AsyncIterable<PcmChunk> {
  const sentences = splitSentences(text);
  for (const s of sentences) {
    if (signal.aborted) return;
    const wav = await engine.synthesize(s, opts);
    if (signal.aborted) return;
    yield { pcm: wavToPcm(wav), sampleRate: engine.capabilities.sampleRate };
  }
}
