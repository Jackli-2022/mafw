/**
 * 共享的无状态直连 HTTP 补全传输（OpenAI-compatible chat completions）。
 * opencode runtime 的 completion.complete 与 index-scan 的回退路径共用本模块。
 */
import type { CompletionRequest, CompletionResult } from './contract';
import { getProviderApiKey } from './auth';

export interface HttpCompletionDeps {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  authPath?: string;
  credentials?: { getApiKey(provider: string): string | null };
  scanEndpoints?: Record<string, string>;
  resolveEndpoint?: (providerID: string) => Promise<string | null>;
  resolveApiKey?: (providerID: string) => Promise<string | null>;
}

/** providerID → chat-completions URL。config scanEndpoints 优先于硬编码表。 */
export function resolveCompletionBaseUrl(providerID?: string, endpoints?: Record<string, string>): string | undefined {
  if (!providerID) return undefined;
  const mapped = endpoints?.[providerID];
  if (mapped) return mapped;
  const p = providerID.toLowerCase();
  if (p.includes('alibaba') || p.includes('dashscope') || p.includes('qwen')) {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  }
  return undefined;
}

function buildUserContent(user: CompletionRequest['user']): string | any[] {
  if (user.length === 1 && user[0].type === 'text') return user[0].text;
  return user.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } },
  );
}

export async function httpComplete(req: CompletionRequest, deps: HttpCompletionDeps = {}): Promise<CompletionResult> {
  const providerID = req.model.providerID;
  const baseUrl = deps.baseUrl
    ?? (await deps.resolveEndpoint?.(providerID) ?? undefined)
    ?? resolveCompletionBaseUrl(providerID, deps.scanEndpoints);
  const apiKey = deps.apiKey
    ?? (await deps.resolveApiKey?.(providerID) ?? undefined)
    ?? getProviderApiKey(providerID, deps.authPath, deps.credentials);
  if (!baseUrl || !apiKey) {
    throw new Error(`completion: no endpoint or API key for provider "${providerID}"`);
  }

  const systemContent = (req.system ?? []).map((b) =>
    b.cacheable
      ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: b.text },
  );
  const messages: any[] = [];
  if (systemContent.length > 0) messages.push({ role: 'system', content: systemContent });
  messages.push({ role: 'user', content: buildUserContent(req.user) });

  const timeoutMs = req.timeoutMs ?? 30_000;
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
  const resp = await Promise.race([
    fetchFn(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model.modelID,
        messages,
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 4096,
      }),
    }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('completion timeout')), timeoutMs);
      timer.unref?.();
    }),
  ]) as any;

  if (!resp?.ok) {
    const text = await resp?.text?.().catch(() => '') ?? '';
    throw new Error(`completion failed: HTTP ${resp?.status}: ${String(text).slice(0, 200)}`);
  }

  const json = await resp.json();
  const message = json?.choices?.[0]?.message;
  let text = typeof message?.content === 'string' ? message.content : '';
  // Reasoning models may put the answer in reasoning_content when content is empty.
  if (!text.trim() && typeof message?.reasoning_content === 'string') {
    text = message.reasoning_content;
  }

  const usage = json?.usage;
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  return {
    text,
    usage: usage
      ? {
          input: Math.max(0, (usage.prompt_tokens || 0) - (cached || 0)),
          cached: cached || 0,
          output: usage.completion_tokens || 0,
        }
      : undefined,
  };
}
