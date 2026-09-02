// Embedding providers for dense retrieval (P1).
//
// Two transports share one interface:
//   - dashscope: native DashScope text-embedding HTTP API (text-embedding-v4 =
//     hosted Qwen3-Embedding; qwen3.7-text-embedding for 128K context). Auth
//     reuses the runtime credentials → opencode auth.json chain, same as the
//     index scan. Cheap (¥0.0005/1K tokens) but adds 100-500ms network latency,
//     so callers must keep it off the synchronous 100ms recall path.
//   - local: ONNX Qwen3-Embedding-0.6B via @huggingface/transformers
//     (lazy model download to HF_HOME). Slower per call on CPU but zero
//     network dependency — suitable for the sync path with small indexes.
//
// Query/document asymmetry follows the Qwen3-Embedding recipe: query inputs
// get an `Instruct:` task prefix, document inputs are embedded verbatim.

import { log } from '../core/utils/logger';
import { getProviderApiKey } from '../runtime/auth';

// Mirror + cache home for local ONNX model downloads (same policy as reranker).
import * as path from 'path';
import * as os from 'os';
if (typeof process !== 'undefined') {
  process.env.HF_ENDPOINT = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
  process.env.HF_HOME = process.env.HF_HOME || path.join(os.homedir(), '.mafw', 'models', 'huggingface');
}

export type EmbeddingKind = 'query' | 'document';

export interface EmbeddingProvider {
  name: string;
  dims: number;
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: 'off' | 'local' | 'dashscope';
  model?: string;
  dimensions?: number;
  /** Explicit endpoint override (dashscope). */
  baseUrl?: string;
  apiKey?: string;
  authPath?: string;
  credentials?: { getApiKey(provider: string): string | null };
  fetchFn?: typeof fetch;
  /** Test seam: inject a model factory for the local provider (no download). */
  localDeps?: { modelFactory?: (model: string) => Promise<any> };
}

const DASHSCOPE_EMBEDDING_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';

const DEFAULT_QUERY_TASK =
  'Given a user query, retrieve the most relevant memory entries from a long-term agent memory store';

export function resolveEmbeddingBaseUrl(providerID?: string): string | undefined {
  if (!providerID) return undefined;
  const p = providerID.toLowerCase();
  if (p === 'alibaba-cn' || p === 'dashscope' || p === 'qwen') {
    return DASHSCOPE_EMBEDDING_URL;
  }
  return undefined;
}

export function buildQueryInput(text: string, opts: { asDocument?: boolean } = {}): string {
  if (opts.asDocument) return text;
  return `Instruct: ${DEFAULT_QUERY_TASK}\nQuery: ${text}`;
}

export function createEmbeddingProvider(cfg: EmbeddingProviderConfig): EmbeddingProvider | null {
  if (!cfg.provider || cfg.provider === 'off') return null;
  if (cfg.provider === 'dashscope') {
    return new DashScopeEmbeddingProvider(cfg);
  }
  if (cfg.provider === 'local') {
    return new LocalEmbeddingProvider(cfg);
  }
  return null;
}

// ── DashScope native text-embedding API ─────────────────────────────────────

class DashScopeEmbeddingProvider implements EmbeddingProvider {
  name: string;
  dims: number;
  private apiKey?: string;
  private authPath?: string;
  private credentials?: { getApiKey(provider: string): string | null };
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private maxBatch: number;
  private queryCache = new Map<string, number[][]>();

  constructor(cfg: EmbeddingProviderConfig) {
    this.name = `dashscope:${cfg.model || 'text-embedding-v4'}`;
    this.dims = cfg.dimensions || 1024;
    this.apiKey = cfg.apiKey;
    this.authPath = cfg.authPath;
    this.credentials = cfg.credentials;
    this.fetchFn = cfg.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = cfg.baseUrl || DASHSCOPE_EMBEDDING_URL;
    // v4 batch limit is 10 rows; qwen3.7-text-embedding allows 20.
    this.maxBatch = (cfg.model || '').includes('qwen3.7') ? 20 : 10;
  }

  private resolveKey(): string | null {
    if (this.apiKey) return this.apiKey;
    const providerID = 'alibaba-cn';
    return getProviderApiKey(providerID, this.authPath, this.credentials) ?? null;
  }

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (kind === 'query' && texts.length === 1) {
      const cached = this.queryCache.get(texts[0]);
      if (cached) return cached;
    }

    const apiKey = this.resolveKey();
    if (!apiKey) {
      throw new Error('no dashscope API key resolvable for embedding (credentials/auth.json)');
    }

    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < texts.length; i += this.maxBatch) {
      const batch = texts.slice(i, i + this.maxBatch);
      const batchVectors = await this.embedBatch(batch, kind);
      for (let j = 0; j < batchVectors.length; j++) out[i + j] = batchVectors[j];
    }

    if (kind === 'query' && texts.length === 1) {
      if (this.queryCache.size >= 256) {
        const first = this.queryCache.keys().next().value;
        if (first !== undefined) this.queryCache.delete(first);
      }
      this.queryCache.set(texts[0], out);
    }
    return out;
  }

  private async embedBatch(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    // OpenAI-compatible embeddings shape (dashscope compatible-mode). The
    // native text_type=query/document asymmetry is unavailable here — query
    // asymmetry is instead carried by buildQueryInput's Instruct prefix.
    void kind;
    const body = {
      model: this.modelName(),
      input: texts,
      dimensions: this.dims,
      encoding_format: 'float',
    };
    const resp = await this.fetchFn(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyOf(this.resolveKey())}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`dashscope embedding failed: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const rows: Array<{ index: number; embedding: number[] }> = data?.data || [];
    const byIndex = new Map<number, number[]>();
    for (const e of rows) byIndex.set(e.index, e.embedding);
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const vec = byIndex.get(i);
      if (!vec) throw new Error('dashscope embedding response missing index ' + i);
      out.push(vec);
    }
    return out;
  }

  private modelName(): string {
    return this.name.slice('dashscope:'.length);
  }
}

function apiKeyOf(key: string | null): string {
  return key ?? '';
}

// ── Local ONNX (Qwen3-Embedding via @huggingface/transformers) ──────────────

export interface LocalModelHandle {
  tokenizer: (texts: string[], opts?: any) => Promise<any> | any;
  model: (inputs: any, opts?: any) => Promise<any> | any;
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  name: string;
  dims: number;
  private modelId: string;
  private localDeps?: { modelFactory?: (model: string) => Promise<LocalModelHandle> };
  private handle: LocalModelHandle | null = null;
  private loading: Promise<LocalModelHandle> | null = null;

  constructor(cfg: EmbeddingProviderConfig) {
    this.name = `local:${cfg.model || 'onnx-community/Qwen3-Embedding-0.6B-ONNX'}`;
    this.dims = cfg.dimensions || 1024;
    this.modelId = cfg.model || 'onnx-community/Qwen3-Embedding-0.6B-ONNX';
    this.localDeps = cfg.localDeps as any;
  }

  private async ensureHandle(): Promise<LocalModelHandle> {
    if (this.handle) return this.handle;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (this.localDeps?.modelFactory) {
        this.handle = await this.localDeps.modelFactory(this.modelId);
        return this.handle;
      }
      const mod: any = await new Function('spec', 'return import(spec)')('@huggingface/transformers');
      mod.env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com/';
      // Persist the model cache under the MAFW data root — the transformers.js
      // default (<package>/.cache) is wiped on every `npm install -g` upgrade.
      mod.env.cacheDir = path.join(os.homedir(), '.mafw', 'models', 'huggingface');
      const tokenizer = await mod.AutoTokenizer.from_pretrained(this.modelId);
      const model = await mod.AutoModel.from_pretrained(this.modelId, { dtype: 'q8' });
      this.handle = { tokenizer, model };
      return this.handle;
    })().catch((err: any) => {
      this.loading = null;
      log.warn(`[Embedding] local model load failed: ${err?.message || err}`);
      throw err;
    });
    return this.loading;
  }

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    const { tokenizer, model } = await this.ensureHandle();
    const inputs = texts.map(t => (kind === 'query' ? buildQueryInput(t) : buildQueryInput(t, { asDocument: true })));
    const tokenized = await tokenizer(inputs, { padding: true, truncation: true });
    const output = await model(tokenized);
    const lhs = output.last_hidden_state;
    if (!lhs?.dims || lhs.dims.length !== 3) {
      throw new Error('unexpected model output shape for embedding (expected last_hidden_state [B,L,H])');
    }
    const [B, L, H] = lhs.dims;
    const mask: ArrayLike<bigint | number> = tokenized.attention_mask?.data ?? [];
    const out: number[][] = [];
    for (let b = 0; b < B; b++) {
      // Last non-pad token (Qwen3-Embedding uses last-token pooling).
      let lastIdx = L - 1;
      if (mask.length >= (b + 1) * L) {
        lastIdx = 0;
        for (let t = 0; t < L; t++) {
          if (Number(mask[b * L + t]) === 1) lastIdx = t;
        }
      }
      const offset = (b * L + lastIdx) * H;
      const row = Array.from(lhs.data.subarray(offset, offset + H) as Float32Array);
      const nrm = Math.sqrt(row.reduce((s, x) => s + x * x, 0)) || 1;
      out.push(row.map(x => x / nrm));
    }
    return out;
  }
}
