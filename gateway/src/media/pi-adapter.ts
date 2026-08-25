import { DEFAULT_AUTH_PATH, readOpencodeAuth } from './auth-util';
import type { PromptFn, PromptPart } from './media-service';

/**
 * Pi media adapter — implements the gateway's PromptFn abstraction with
 * pi-coding-agent as the media analysis engine.
 *
 * Flow (path A, verified POC):
 *   media file part (data URL) → PiAiImage carrier ({type:'image', data, mimeType})
 *   → pi's openai-completions serializer turns non-text parts into image_url
 *   → fixMediaPayload (onPayload hook) rewrites the wire format:
 *       video/* → { type:'video_url', video_url:{url} }        (Xiaomi video format)
 *       audio/* → { type:'input_audio', input_audio:{data:url} } (Xiaomi audio format)
 *   → the configured model (e.g. xiaomi/mimo-v2.5) receives the media natively.
 *
 * Credentials are reused from opencode's auth.json (the provider must be
 * connected in opencode, e.g. `xiaomi`); the key is injected at runtime via
 * setRuntimeApiKey and never persisted by pi.
 *
 * The fixer is derived from pi-multimodal-proxy's fixVideoAudioPayload (MIT);
 * the audio branch was changed to input_audio per the Xiaomi MiMo API docs.
 */

export function fixMediaPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const messages = p.messages;
  if (!Array.isArray(messages)) return undefined;
  let modified = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;
    const content = m.content;
    if (!Array.isArray(content)) continue;
    for (let i = 0; i < content.length; i++) {
      const block = content[i];
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'image_url' && b.image_url && typeof b.image_url === 'object') {
        const iu = b.image_url as Record<string, unknown>;
        const url = iu.url;
        if (typeof url === 'string' && url.startsWith('data:')) {
          const mimeMatch = url.match(/^data:([^;]+);/);
          if (mimeMatch) {
            const mime = mimeMatch[1]!.toLowerCase();
            if (mime.startsWith('video/')) {
              content[i] = { type: 'video_url', video_url: { url } };
              modified = true;
            } else if (mime.startsWith('audio/')) {
              // Xiaomi MiMo audio format: input_audio with the full data URI.
              content[i] = { type: 'input_audio', input_audio: { data: url } };
              modified = true;
            }
          }
        }
      }
    }
  }
  return modified ? p : undefined;
}

export interface PiAdapterDeps {
  /** opencode auth.json path (default ~/.local/share/opencode/auth.json). */
  authPath?: string;
  /** Overrides auth.json lookup (tests). */
  getApiKey?: (provider: string) => string | undefined;
  /** Model registry hook (tests) — default uses ModelRuntime. */
  getModel?: (provider: string, model: string) => unknown | undefined;
  timeoutMs?: number;
  /** Custom wire format fixer (default: fixMediaPayload for Xiaomi). */
  fixPayload?: (payload: unknown) => unknown;
}

export function createPiPromptAdapter(deps: PiAdapterDeps = {}): PromptFn {
  const authPath = deps.authPath ?? DEFAULT_AUTH_PATH();
  const timeoutMs = deps.timeoutMs ?? 180_000;
  let runtimePromise: Promise<any> | undefined;

  function runtime(): Promise<any> {
    if (!runtimePromise) {
      // pi-coding-agent is ESM-only and this gateway package compiles to CJS.
      // A static import (and even a tsc-compiled dynamic import) becomes a
      // require() of an ESM package and throws, so load it through a runtime
      // dynamic import() that tsc cannot rewrite.
      runtimePromise = (async () => {
        const imp = new Function('spec', 'return import(spec)') as (s: string) => Promise<any>;
        const { ModelRuntime } = await imp('@earendil-works/pi-coding-agent');
        const mr = await ModelRuntime.create({ signal: AbortSignal.timeout(30_000) });
        return mr;
      })();
      runtimePromise.catch(() => { runtimePromise = undefined; });
    }
    return runtimePromise;
  }

  async function modelFor(provider: string, model: string): Promise<any> {
    if (deps.getModel) {
      const m = deps.getModel(provider, model);
      if (!m) throw new Error(`Model ${provider}/${model} not found`);
      return m;
    }
    const mr = await runtime();
    const m = mr.getModel(provider, model);
    if (!m) throw new Error(`Model ${provider}/${model} not found in pi registry`);
    return m;
  }

  return async function piPrompt(parts: PromptPart[], opts: { providerID: string; modelID: string }): Promise<string> {
    const apiKey = deps.getApiKey
      ? deps.getApiKey(opts.providerID)
      : readOpencodeAuth(authPath)[opts.providerID]?.key;
    if (!apiKey) {
      throw new Error(`No API key for provider "${opts.providerID}" — connect it in opencode first (auth.json)`);
    }

    const filePart = parts.find((p) => p.type === 'file');
    const textPart = parts.find((p) => p.type === 'text');
    const model = await modelFor(opts.providerID, opts.modelID);

    const content: any[] = [];
    if (textPart && typeof textPart.text === 'string' && textPart.text.trim()) {
      content.push({ type: 'text', text: textPart.text });
    }
    if (filePart && typeof filePart.url === 'string' && filePart.url.startsWith('data:')) {
      const dataUrl = filePart.url;
      const mime = (filePart.mime as string) || dataUrl.match(/^data:([^;]+);/)?.[1] || 'image/png';
      const data = dataUrl.includes(',') ? dataUrl.split(',')[1] || '' : '';
      // PiAiImage carrier — pi serializes it as image_url, fixMediaPayload
      // rewrites the wire format to video_url / input_audio.
      content.push({ type: 'image', data, mimeType: mime });
    }
    if (content.length === 0) {
      throw new Error('Pi adapter requires at least one text or file part');
    }

    const mr = await runtime();
    await mr.setRuntimeApiKey(opts.providerID, apiKey);

    const logger = await import('../core/utils/logger.js');
    try {
      const response = await mr.complete(
      model,
      {
        systemPrompt: 'You are a precise media analysis assistant. Answer the user\'s question about the attached media concisely and factually.',
        messages: [
          {
            role: 'user',
            content,
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        onPayload: deps.fixPayload ?? fixMediaPayload,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(response.errorMessage || `Media analysis failed (${response.stopReason})`);
    }
    return (response.content || [])
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
    } catch (err: any) {
      logger.log.error(`[PiAdapter] ${opts.providerID}/${opts.modelID} baseUrl=${(model as any).baseUrl} failed: ${err?.message || String(err)}`);
      throw err;
    }
  };
}
