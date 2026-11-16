// Real embedding provider for the T1 eval. Uses the configured provider factory
// (same code path as the gateway) so the dynamic llama.cpp port is not hardcoded.
import { config } from '../../../gateway/src/config';
import { initEmbeddingRuntime } from '../../../gateway/src/memory/embedding-runtime';
import type { SemanticEmbedder } from '../../../gateway/src/recall/t1-semantic-atoms';

export interface RealEmbedderHandle {
  embedder: SemanticEmbedder;
  model: string;
  dispose: () => Promise<void>;
}

export function createRealEmbedder(baseDir: string): RealEmbedderHandle {
  const runtime = initEmbeddingRuntime({
    baseDir,
    cfg: config.memory.embedding,
  });
  if (!runtime?.provider) {
    throw new Error('embedding runtime unavailable (check config.memory.embedding)');
  }
  const provider = runtime.provider;
  return {
    embedder: {
      embed: (texts, kind) => provider.embed(texts, kind),
    },
    model: provider.modelTag ?? provider.name,
    dispose: async () => {
      await provider.dispose?.();
    },
  };
}
