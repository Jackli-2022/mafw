/** TTS 引擎能力声明 —— 缺省字段视为不支持（fail-open 哲学）。 */
export interface TtsCapabilities {
  /** native=边生成边出块；none=只支持整段，走句切分适配层 */
  streaming: 'native' | 'none';
  voiceCloning: boolean;
  styleControl: boolean;
  languages: string[];
  /** 引擎原生采样率（22.05k/24k/32-48k 并存，不强写 24k） */
  sampleRate: number;
}

export interface TtsOpts {
  voice?: string;
  style?: string;
  speed?: number;
  lang?: string;
  /** 声音克隆参考音频（预留；不支持的引擎忽略） */
  refAudio?: { path: string; text?: string };
}

export interface TtsVoice {
  id: string;
  label: string;
  lang: string;
}

export interface PcmChunk {
  pcm: Buffer;
  sampleRate: number;
}

export interface TtsEngine {
  name: string;
  capabilities: TtsCapabilities;
  voices(): TtsVoice[];
  synthesizeStream(text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk>;
  /** 整段 wav（兜底路径） */
  synthesize(text: string, opts: TtsOpts): Promise<Buffer>;
}
