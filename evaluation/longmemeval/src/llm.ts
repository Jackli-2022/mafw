import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OpencodeAuth {
  provider?: string;
  key?: string;
}

export function loadAuthKey(provider = 'opencode-go'): string {
  const base = os.platform() === 'win32'
    ? process.env.USERPROFILE ?? process.env.HOME
    : process.env.HOME;
  const authPath = path.join(base ?? os.homedir(), '.local', 'share', 'opencode', 'auth.json');
  if (!fs.existsSync(authPath)) {
    throw new Error(`auth.json not found at ${authPath}; run 'opencode connect' first`);
  }
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as Record<string, OpencodeAuth>;
  const entry = auth[provider];
  if (!entry?.key) throw new Error(`No key for provider ${provider} in ${authPath}`);
  return entry.key;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  apiUrl?: string;
  apiKey?: string;
}

export interface ChatResult {
  content: string;
  finishReason: string;
  truncated: boolean;
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const result = await chatCompletionFull(opts);
  return result.content;
}

export async function chatCompletionFull(opts: ChatOptions): Promise<ChatResult> {
  const url = opts.apiUrl ?? 'https://opencode.ai/zen/go/v1/chat/completions';
  const key = opts.apiKey ?? loadAuthKey('opencode-go');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      // OpenRouter rankings reward identification; harmless on other providers.
      'HTTP-Referer': 'https://opencode.ai',
      'X-Title': 'MAFW LongMemEval benchmark',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.0,
      max_tokens: opts.max_tokens ?? 512,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM request failed ${resp.status}: ${text}`);
  }
  const json = await resp.json() as any;
  const choice = json.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason ?? 'unknown';
  let content = message?.content;
  // Reasoning models (e.g. mimo) put thinking in reasoning_content; if content
  // is empty (finish_reason=length cut reasoning off), fall back to it so the
  // benchmark still gets a usable signal.
  if (typeof content !== 'string' || !content.trim()) {
    content = message?.reasoning_content;
  }
  if (typeof content !== 'string') {
    throw new Error('LLM response missing content');
  }
  return {
    content,
    finishReason,
    truncated: finishReason === 'length',
  };
}

/** Best-effort JSON extraction; falls back to raw string. */
export function extractJson<T = any>(text: string): T | null {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1)) as T;
  } catch {
    return null;
  }
}
