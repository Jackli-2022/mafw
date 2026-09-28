/**
 * Process-wide reranker singleton, keyed by name+GPU so a config change
 * rebuilds it. Shared by the explicit search handler and the R8 snapshot
 * builder so both reuse ONE llama-server sidecar (spawning a second one costs
 * ~600MB VRAM and ~5s of model load).
 */
import { config } from '../../config';
import { createReranker, Reranker } from './reranker';

let cached: { key: string; r: Reranker } | null = null;

export function getReranker(): Reranker | null {
  const name = config.search.reranker;
  if (name === 'off') return null;
  const key = `${name}:${config.search.rerankerGpu}`;
  if (cached?.key === key) return cached.r;
  try {
    const r = createReranker(name, config.search.rerankWeights, { gpu: config.search.rerankerGpu });
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
