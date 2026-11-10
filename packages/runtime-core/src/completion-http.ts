/**
 * 共享的无状态直连 HTTP 补全传输（OpenAI-compatible chat completions）。
 *
 * Plan 6 Task 3：从 `gateway/src/runtime/completion-http.ts` 平移，gateway 模块
 * 保留为 re-export shim，opencode runtime 的 completion.complete 与 index-scan
 * 的回退路径继续共用同一实现。
 *
 * Credential isolation: this module never touches the filesystem or the gateway
 * auth module. The caller injects a `credentials` resolver (or an explicit
 * `apiKey` / async `resolveApiKey`); nothing here reads `auth.json`.
 */

/** Structural request DTO (mirrors the gateway/adaptor completion request). */
export interface HttpCompletionRequest {
  model: { providerID: string; modelID: string };
  system?: Array<{ text: string; cacheable?: boolean }>;
  user: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string } // data = base64（无 data: 前缀）
  >;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** 约束输出为 JSON Schema（映射不了则忽略，fail-open）。 */
  responseFormat?: {
    type: 'json_schema';
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface HttpCompletionResult {
  text: string;
  /** undefined = provider 未回传 usage；消费方据此跳过记账 */
  usage?: { input: number; cached: number; output: number };
}

export interface HttpCompletionDeps {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  /**
   * Caller-provided credential resolver. Only consulted when `apiKey` and
   * `resolveApiKey` yield nothing — the gateway passes its auth.json chain here.
   */
  credentials?: (providerID: string) => string | null | undefined;
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

function buildUserContent(user: HttpCompletionRequest['user']): string | any[] {
  if (user.length === 1 && user[0].type === 'text') return user[0].text;
  return user.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } },
  );
}

export async function httpComplete(
  req: HttpCompletionRequest,
  deps: HttpCompletionDeps = {},
): Promise<HttpCompletionResult> {
  const providerID = req.model.providerID;
  const baseUrl = deps.baseUrl
    ?? (await deps.resolveEndpoint?.(providerID) ?? undefined)
    ?? resolveCompletionBaseUrl(providerID, deps.scanEndpoints);
  const apiKey = deps.apiKey
    ?? (await deps.resolveApiKey?.(providerID) ?? undefined)
    ?? deps.credentials?.(providerID)
    ?? undefined;
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
        ...(req.responseFormat
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: req.responseFormat.name,
                  schema: req.responseFormat.schema,
                  ...(req.responseFormat.strict !== undefined ? { strict: req.responseFormat.strict } : {}),
                },
              },
            }
          : {}),
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
