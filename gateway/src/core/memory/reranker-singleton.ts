/**
 * Process-wide reranker singleton, keyed by name+GPU so a config change
 * rebuilds it. Shared by the explicit search handler and the R8 snapshot
 * builder so both reuse ONE llama-server sidecar (spawning a second one costs
 * ~600MB VRAM and ~5s of model load).
 */
import { config } from '../../config';
import { createRerankerProviderRegistry } from '../../memory/reranker-registry';
import type { Reranker } from './reranker';

const registry = createRerankerProviderRegistry({ retainCreated: false });
let cached: { key: string; r: Reranker } | null = null;

function disposeReranker(reranker: Reranker | null | undefined): void {
  if (!reranker) return;
  try {
    if (typeof reranker.dispose === 'function') {
      reranker.dispose();
      return;
    }
    const legacy = (reranker as { killServer?: () => void }).killServer;
    if (typeof legacy === 'function') legacy.call(reranker);
  } catch { /* best effort */ }
}

export function getReranker(): Reranker | null {
  const name = config.search.reranker;
  if (name === 'off') return null;
  const key = `${name}:${config.search.rerankerGpu}:${config.search.rerankerBatchSize}`;
  if (cached?.key === key) return cached.r;
  // Config hot-reload replaced the instance — without this the previous
  // llama-server keeps running (one orphan per change, ~1.1GB VRAM each).
  disposeReranker(cached?.r);
  try {
    const r = registry.create(name, config.search.rerankWeights, {
      gpu: config.search.rerankerGpu,
      batchSize: config.search.rerankerBatchSize,
    });
    cached = r ? { key, r } : null;
  } catch {
    cached = null;
  }
  return cached?.r ?? null;
}

/** Test hook: drop the cached instance. */
export function resetRerankerSingleton(): void {
  cached = null;
}
