import { createHash } from 'crypto';

/**
 * MediaService — multimodal (image / video / audio) analysis client that
 * routes every request through the opencode server SDK (`session.prompt`).
 *
 * Credentials and endpoints are owned by opencode: the caller (gateway) only
 * picks the model per modality (`{ providerID, modelID }`) and opencode
 * resolves the provider's API key from its own auth store. No MAFW-side API
 * key or base URL is required.
 *
 * Configuration comes from the gateway config `media:` section:
 *   provider: 'xiaomi'              — opencode provider that owns the key
 *   model:    'mimo-v2.5'           — default model for every modality
 *   image/video/audio: { provider?, model } — per-modality overrides
 *   lang: 'zh'                      — optional answer-language instruction
 *
 * The gateway owns cache, retries and logging; the plugin only does hook
 * shape work (job collection, focus hints, channel note, failure note).
 */

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaModelRef {
  /** Provider owning the credentials (falls back to MediaConfig.provider). */
  provider?: string;
  /** Model ID as configured in opencode (e.g. mimo-v2.5). */
  model: string;
  /** Engine name override (falls back to MediaConfig.engine, then 'pi'). */
  engine?: string;
}

export interface MediaConfig {
  provider: string;
  model: string;
  /** Default engine name (default: 'pi'). */
  engine?: string;
  image?: MediaModelRef;
  video?: MediaModelRef;
  audio?: MediaModelRef;
  lang?: string;
}

export interface MediaInput {
  kind: MediaKind;
  /** data URL (data:<mime>;base64,...) */
  dataUrl: string;
  mediaType: string;
}

/** opencode part accepted by session.prompt (FilePart shape + text). */
export type PromptPart = { type: string; [key: string]: unknown };

export interface PromptOptions {
  providerID: string;
  modelID: string;
  system?: string;
}

export type PromptFn = (parts: PromptPart[], opts: PromptOptions) => Promise<string>;

export const DESCRIBE_PROMPT = 'Please describe the contents of this media in detail.';
export const LANG_INSTRUCTIONS: Record<string, string> = {
  zh: '请使用简体中文回答。',
  en: 'Please respond in English.',
};

/**
 * 音频理解结构化 prompt（opt-in）——要求模型返回 JSON：
 *   { "transcript": "转写文本", "emotion": "情绪", "tone": "语调/语气", "confidence": 0-1 }
 * 仅供实时语音对话等需要情绪/语调的场景使用；FLEURS 评测走默认 analyze()，不受影响。
 */
export const AUDIO_STRUCTURED_PROMPT =
  '请分析这段音频内容本身（不要转写本指令），返回 JSON（不要其他内容）：\n' +
  '{"transcript": "语音转写文本；若音频无语音则为声音描述", ' +
  '"emotion": "说话者情绪（如 高兴/沮丧/愤怒/中性/惊讶；无语音则 null）", ' +
  '"tone": "语调起伏/语气（如 平稳/激动/低沉/上扬；无语音则 null）", "confidence": 0.0-1.0}';

/**
 * 音频首轮叙述式分析 prompt（主 Agent 场景）：自然语言描述内容 + 情绪/语调轨迹 + 意图，
 * 不强制 JSON——主 Agent（文本模型）直接理解，无需解析层。
 */
export const AUDIO_NARRATIVE_PROMPT =
  '请分析这段音频，用自然语言按顺序描述：\n' +
  '1. 内容：说话者说了什么（完整转写；若音频无语音，则描述声音本身，如环境音/音乐/效果声）\n' +
  '2. 情绪与语调变化：语气起伏、语速、停顿等细节（如"开头平静，说到\'…\'时语速加快、语调上扬，' +
  '明显不满；最后\'…\'时语气放缓，带妥协与无奈"）\n' +
  '3. 意图：说话者的目的与态度\n' +
  '可用"开头 / 说到这句时 / 最后"等相对位置描述，不要求精确时间戳。\n' +
  '不要输出 JSON，用流畅的中文。';

const CACHE_MAX = 128;

export function kindFromMediaType(mediaType: string): MediaKind {
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('audio/')) return 'audio';
  return 'image';
}

export interface MediaServiceDeps {
  /** Invokes the opencode server with the given parts + model. */
  prompt: PromptFn;
  /** Optional live config reader (gateway config.raw.media); defaults apply. */
  config?: () => Partial<MediaConfig>;
  /** Optional engine resolver per modality (plugin system). */
  resolvePrompt?: (kind: MediaKind, cfg: MediaConfig) => PromptFn | undefined;
}

export class MediaService {
  private cache = new Map<string, string>();

  constructor(private readonly deps: MediaServiceDeps) {}

  /** Effective media config (gateway config merged over defaults). */
  loadConfig(): MediaConfig {
    const base = { provider: 'xiaomi', model: 'mimo-v2.5' };
    const fromCfg = this.deps.config ? (this.deps.config() ?? {}) : {};
    const merged: MediaConfig = { ...base, ...fromCfg };
    return merged;
  }

  /** Media routing is ready whenever a prompt channel was injected. */
  get isConfigured(): boolean {
    return !!this.deps?.prompt;
  }

  /** Resolve the provider/model pair for a modality (per-modality, else default). */
  modelFor(cfg: MediaConfig, kind: MediaKind): { providerID: string; modelID: string } {
    const ref: MediaModelRef = cfg[kind] ?? { model: '' };
    return {
      providerID: ref.provider || cfg.provider,
      modelID: ref.model || cfg.model,
    };
  }

  cacheKey(kind: MediaKind, engine: string, providerID: string, modelID: string, mediaUrl: string, prompt: string): string {
    return createHash('sha256')
      .update(kind)
      .update('\x00')
      .update(engine)
      .update('\x00')
      .update(providerID)
      .update('\x00')
      .update(modelID)
      .update('\x00')
      .update(mediaUrl)
      .update('\x00')
      .update(prompt)
      .digest('hex');
  }

  /**
   * Analyze media (image / video / audio) with the model configured for that
   * modality. Routes through the opencode server via the injected PromptFn —
   * opencode performs the provider auth and the multimodal part conversion.
   */
  async analyze(input: MediaInput, promptText: string): Promise<string> {
    const kind = input.kind || kindFromMediaType(input.mediaType);
    const cfg = this.loadConfig();
    const { providerID, modelID } = this.modelFor(cfg, kind);
    const engineName = cfg[kind]?.engine ?? cfg.engine ?? 'pi';
    const promptFn = this.deps.resolvePrompt?.(kind, cfg) ?? this.deps.prompt;
    const cacheKey = this.cacheKey(kind, engineName, providerID, modelID, input.dataUrl, promptText);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    let text = promptText || DESCRIBE_PROMPT;
    if (cfg.lang) text = LANG_INSTRUCTIONS[cfg.lang] + '\n\n' + text;

    const ext = (input.mediaType.split('/')[1] || 'bin').split(';')[0].split('+')[0];
    const parts: PromptPart[] = [
      {
        type: 'file',
        mime: input.mediaType,
        filename: `media.${ext}`,
        url: input.dataUrl,
      },
      { type: 'text', text },
    ];

    let result: string;
    try {
      result = await promptFn(parts, { providerID, modelID });
    } catch (err) {
      throw new MediaError(`Media API request failed: ${(err as Error).message}`);
    }
    if (!result || !result.trim()) {
      throw new MediaError('Media API returned an empty description');
    }

    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Describe an image — image-only convenience entry. */
  async describe(imageUrl: string, prompt: string): Promise<string> {
    return this.analyze({ kind: 'image', dataUrl: imageUrl, mediaType: 'image/png' }, prompt);
  }

  /**
   * 音频理解（结构化）：返回 JSON { transcript, emotion, tone, confidence }。
   * 独立于默认 analyze()——默认路径与 FLEURS 评测兼容，此方法仅供需要情绪/语调的场景。
   */
  async analyzeAudioStructured(input: MediaInput, promptText?: string): Promise<string> {
    const cfg = this.loadConfig();
    const { providerID, modelID } = this.modelFor(cfg, 'audio');
    const engineName = cfg.audio?.engine ?? cfg.engine ?? 'pi';
    const promptFn = this.deps.resolvePrompt?.('audio', cfg) ?? this.deps.prompt;
    const prompt = `${AUDIO_STRUCTURED_PROMPT}\n\n${promptText || ''}`.trim();
    const cacheKey = this.cacheKey('audio', engineName, providerID, modelID, input.dataUrl, prompt);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const ext = (input.mediaType.split('/')[1] || 'bin').split(';')[0].split('+')[0];
    const parts: PromptPart[] = [
      { type: 'file', mime: input.mediaType, filename: `media.${ext}`, url: input.dataUrl },
      { type: 'text', text: prompt },
    ];

    let result: string;
    try {
      result = await promptFn(parts, { providerID, modelID });
    } catch (err) {
      throw new MediaError(`Media API request failed: ${(err as Error).message}`);
    }
    if (!result || !result.trim()) {
      throw new MediaError('Media API returned an empty structured analysis');
    }

    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * 音频首轮叙述式分析（主 Agent 场景）：自然语言输出内容转写 + 情绪/语调轨迹 + 意图。
   * 与 analyzeAudioStructured 独立——不强制 JSON，无解析层。
   */
  async analyzeAudioNarrative(input: MediaInput): Promise<string> {
    return this.analyze(
      { kind: 'audio', dataUrl: input.dataUrl, mediaType: input.mediaType },
      AUDIO_NARRATIVE_PROMPT,
    );
  }
}
