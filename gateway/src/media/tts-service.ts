import { getProviderApiKey } from '../runtime/auth';
import type { RuntimeCredentials } from '../runtime/contract';

/**
 * TtsService — MiMo-V2.5-TTS 语音合成客户端（直连小米 OpenAI 兼容端点）。
 *
 * 官方约束（speech-synthesis-v2.5）：
 *   - 目标合成文本必须放在 role=assistant 的消息中（不可放 user）
 *   - user 消息可选：风格指令（自然语言控制）
 *   - audio.format: 'wav'（非流式）/ 'pcm16'（流式，24kHz mono）
 *   - audio.voice: 预置音色 ID
 *   - 响应：choices[0].message.audio.data（base64 音频）
 *
 * 认证复用 opencode auth.json 的 xiaomi provider key（与 pi-adapter 同源）。
 */

export const TTS_DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1';
export const TTS_DEFAULT_MODEL = 'mimo-v2.5-tts';
export const TTS_DEFAULT_VOICE = '茉莉';

/** 预置音色（9 个 ID；mimo_default 集群相关，下拉建议用命名音色）。 */
export const TTS_VOICES: { id: string; label: string; lang: string }[] = [
  { id: 'mimo_default', label: 'MiMo-默认（集群相关）', lang: 'auto' },
  { id: '冰糖', label: '冰糖', lang: 'zh' },
  { id: '茉莉', label: '茉莉', lang: 'zh' },
  { id: '苏打', label: '苏打', lang: 'zh' },
  { id: '白桦', label: '白桦', lang: 'zh' },
  { id: 'Mia', label: 'Mia', lang: 'en' },
  { id: 'Chloe', label: 'Chloe', lang: 'en' },
  { id: 'Milo', label: 'Milo', lang: 'en' },
  { id: 'Dean', label: 'Dean', lang: 'en' },
];

export interface TtsConfig {
  /** OpenAI-compatible endpoint (default https://api.xiaomimimo.com/v1). */
  baseUrl?: string;
  /** TTS model ID (default mimo-v2.5-tts). */
  model?: string;
  /** Default preset voice (default 茉莉). */
  defaultVoice?: string;
  /** Allowed preset voices (display list). */
  voices?: string[];
}

export interface TtsSynthesizeInput {
  /** 要合成的文本。 */
  text: string;
  /** 预置音色 ID（默认 config defaultVoice / 茉莉）。 */
  voice?: string;
  /** 风格指令（自然语言，user 消息；可选）。 */
  style?: string;
}

export interface TtsSynthesizeResult {
  /** wav data URL（data:audio/wav;base64,...）。 */
  audioDataUrl: string;
  mime: string;
  voice: string;
}

/** 校验并取有效音色（非法/未配置时回退默认）。 */
export function resolveVoice(cfg: TtsConfig, voice?: string): string {
  if (voice && voice.trim()) return voice.trim();
  return cfg.defaultVoice || TTS_DEFAULT_VOICE;
}

export function createTtsService(deps: {
  /** opencode auth.json path（默认 ~/.local/share/opencode/auth.json）。 */
  authPath?: string;
  /** provider 名（默认 xiaomi）。 */
  provider?: string;
  /** 获取配置（含 tts 段）。 */
  config: () => { media?: { tts?: TtsConfig; provider?: string } };
  /** 直连 fetch（测试注入）。 */
  fetchImpl?: typeof fetch;
  /** Runtime credentials（优先于 auth.json）。 */
  credentials?: RuntimeCredentials;
}) {
  const authPath = deps.authPath;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const provider = () => deps.config().media?.provider || 'xiaomi';
  const ttsCfg = (): TtsConfig => deps.config().media?.tts ?? {};

  async function synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    const cfg = ttsCfg();
    const key = getProviderApiKey(provider(), authPath, deps.credentials);
    if (!key) {
      throw new Error(`No API key for provider "${provider()}" — connect it in opencode first (auth.json)`);
    }
    const text = (input.text || '').trim();
    if (!text) throw new Error('TTS requires non-empty text');
    if (text.length > 2000) throw new Error(`TTS text too long (${text.length} > 2000 chars)`);

    const voice = resolveVoice(cfg, input.voice);
    const baseUrl = (cfg.baseUrl || TTS_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = cfg.model || TTS_DEFAULT_MODEL;

    const messages: Array<Record<string, unknown>> = [];
    if (input.style && input.style.trim()) {
      messages.push({ role: 'user', content: input.style.trim() });
    }
    // 官方约束：目标文本必须在 assistant 消息。
    messages.push({ role: 'assistant', content: text });

    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        audio: { format: 'wav', voice },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const parsed: any = await res.json();
    const data = parsed?.choices?.[0]?.message?.audio?.data;
    if (typeof data !== 'string' || !data) {
      const err = parsed?.error?.message || JSON.stringify(parsed).slice(0, 300);
      throw new Error(`TTS empty audio response: ${err}`);
    }
    return {
      audioDataUrl: `data:audio/wav;base64,${data}`,
      mime: 'audio/wav',
      voice,
    };
  }

  /**
   * 流式 TTS：pcm16（24kHz mono）分块输出。返回 async generator，每项是
   * base64 编码的 PCM 块（chunk 边界可能切半个 sample，消费端需保留残余字节）。
   * 调用方负责把块转 SSE 推给客户端。
   */
  async function* synthesizeStream(
    input: TtsSynthesizeInput,
    opts?: { signal?: AbortSignal },
  ): AsyncGenerator<{ data: string; voice: string }> {
    const cfg = ttsCfg();
    const key = getProviderApiKey(provider(), authPath, deps.credentials);
    if (!key) {
      throw new Error(`No API key for provider "${provider()}" — connect it in opencode first (auth.json)`);
    }
    const text = (input.text || '').trim();
    if (!text) throw new Error('TTS requires non-empty text');
    if (text.length > 2000) throw new Error(`TTS text too long (${text.length} > 2000 chars)`);

    const voice = resolveVoice(cfg, input.voice);
    const baseUrl = (cfg.baseUrl || TTS_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = cfg.model || TTS_DEFAULT_MODEL;

    const messages: Array<Record<string, unknown>> = [];
    if (input.style && input.style.trim()) {
      messages.push({ role: 'user', content: input.style.trim() });
    }
    messages.push({ role: 'assistant', content: text });

    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        audio: { format: 'pcm16', voice },
        stream: true,
      }),
      signal: AbortSignal.any([opts?.signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS stream HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta;
            const audioData = delta?.audio?.data;
            if (typeof audioData === 'string' && audioData) {
              yield { data: audioData, voice };
            }
          } catch {
            /* 跳过无法解析的块 */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return { synthesize, synthesizeStream };
}
