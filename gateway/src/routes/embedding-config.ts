// GET/POST /api/memory/embedding-config — memory-system embedding settings.
//
// Follows the model-config.ts deps-injection pattern. POST validates, persists
// to config.yaml, then HOT-SWAPs the embedding runtime (kill old sidecar →
// re-init provider + vector store → background backfill) so an engine switch
// does not require a gateway restart.

import * as http from 'http';

export interface EmbeddingConfigState {
  provider: 'off' | 'local' | 'dashscope';
  engine: 'onnx' | 'llamacpp';
  model: string;
  dimensions: number;
  threads: number;
  llamacpp: {
    gpu: string;
    threads: number;
    contextSize: number;
  };
}

export interface EmbeddingRuntimeState {
  /** Active provider name (e.g. "llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf"), null when off. */
  active: string | null;
  vectors: number;
  indexEntries: number;
  coverage: number;
}

export interface EmbeddingConfigDeps {
  currentConfig: () => EmbeddingConfigState;
  persist: (overrides: Record<string, any>) => { changed: string[] };
  /** Kill the old provider/sidecar and rebuild the runtime from current config. */
  reinit: () => { active: string | null };
  runtimeState: () => EmbeddingRuntimeState;
  /** Kick off a background full backfill (fire-and-forget). */
  scheduleBackfill: () => void;
}

const PROVIDERS = ['off', 'local', 'dashscope'] as const;
const ENGINES = ['onnx', 'llamacpp'] as const;
const GPUS = ['cpu', 'vulkan', 'cuda'] as const;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function handleEmbeddingConfigGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: EmbeddingConfigDeps,
): Promise<void> {
  send(res, 200, {
    current: deps.currentConfig(),
    runtime: deps.runtimeState(),
    available: { providers: PROVIDERS, engines: ENGINES, gpus: GPUS },
  });
}

export interface EmbeddingConfigUpdate {
  provider?: string;
  engine?: string;
  model?: string;
  threads?: number;
  llamacpp?: { gpu?: string; threads?: number; contextSize?: number };
}

export async function handleEmbeddingConfigUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: EmbeddingConfigDeps,
): Promise<void> {
  let body: EmbeddingConfigUpdate;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: 'invalid JSON body' });
    return;
  }
  if (!body || Object.keys(body).length === 0) {
    send(res, 400, { error: 'empty body' });
    return;
  }

  // ── validate ──
  const errors: string[] = [];
  if (body.provider !== undefined && !PROVIDERS.includes(body.provider as any)) {
    errors.push(`provider must be one of ${PROVIDERS.join('|')}`);
  }
  if (body.engine !== undefined && !ENGINES.includes(body.engine as any)) {
    errors.push(`engine must be one of ${ENGINES.join('|')}`);
  }
  if (body.threads !== undefined && (!Number.isInteger(body.threads) || body.threads < 1 || body.threads > 32)) {
    errors.push('threads must be an integer in 1..32');
  }
  if (body.llamacpp?.gpu !== undefined && !GPUS.includes(body.llamacpp.gpu as any)) {
    errors.push(`llamacpp.gpu must be one of ${GPUS.join('|')}`);
  }
  if (body.llamacpp?.threads !== undefined && (!Number.isInteger(body.llamacpp.threads) || body.llamacpp.threads < 1 || body.llamacpp.threads > 32)) {
    errors.push('llamacpp.threads must be an integer in 1..32');
  }
  if (body.llamacpp?.contextSize !== undefined && (!Number.isInteger(body.llamacpp.contextSize) || body.llamacpp.contextSize < 256 || body.llamacpp.contextSize > 32768)) {
    errors.push('llamacpp.contextSize must be an integer in 256..32768');
  }
  if (errors.length > 0) {
    send(res, 400, { error: errors.join('; ') });
    return;
  }

  // ── persist ──
  const embedding: Record<string, any> = {};
  if (body.provider !== undefined) embedding.provider = body.provider;
  if (body.engine !== undefined) embedding.engine = body.engine;
  if (body.model !== undefined) embedding.model = body.model;
  if (body.threads !== undefined) embedding.threads = body.threads;
  if (body.llamacpp && Object.keys(body.llamacpp).length > 0) embedding.llamacpp = body.llamacpp;
  deps.persist({ memory: { embedding } });

  // ── hot-swap the runtime ──
  const reinit = deps.reinit();
  const newCfg = deps.currentConfig();
  // Engine/provider/model changes invalidate existing vectors (different
  // embedding space) — kick off a background backfill; the indexer skips
  // entries whose vectors already exist in the new provider's store file.
  if (reinit.active) deps.scheduleBackfill();

  send(res, 200, {
    success: true,
    current: newCfg,
    runtime: deps.runtimeState(),
    note: reinit.active
      ? 'embedding runtime rebuilt; background backfill started'
      : 'embedding provider off — dense channel disabled',
  });
}
