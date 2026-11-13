// Reranker provider registry.
//
// Rerankers are process-wide singletons in the live gateway. The registry only
// resolves the configured strategy; it never runs on the synchronous boundary
// recall path (see reranker-hot-path.test.ts).
import {
  createReranker,
  type RerankWeights,
  type Reranker,
} from '../core/memory/reranker';
import type { LlamaCppRerankerConfig } from '../core/memory/llamacpp-reranker';

export type RerankerProviderId = 'heuristic' | 'cross-encoder' | 'llamacpp';

export interface RerankerProviderFactory {
  id: RerankerProviderId;
  create(
    weights?: Partial<RerankWeights>,
    opts?: LlamaCppRerankerConfig,
  ): Reranker | null;
}

export interface RerankerProviderRegistry {
  register(factory: RerankerProviderFactory): () => void;
  create(
    id: string,
    weights?: Partial<RerankWeights>,
    opts?: LlamaCppRerankerConfig,
  ): Reranker | null;
  list(): string[];
  dispose(): void;
}

export interface RerankerRegistryOptions {
  /** Production uses false: the singleton owns the live instance. */
  retainCreated?: boolean;
}

function disposeReranker(reranker: Reranker): void {
  try {
    if (typeof reranker.dispose === 'function') {
      reranker.dispose();
      return;
    }
    const legacy = (reranker as { killServer?: () => void }).killServer;
    if (typeof legacy === 'function') legacy.call(reranker);
  } catch {
    // best effort: disposal must not block a config change
  }
}

export function createRerankerProviderRegistry(
  options: RerankerRegistryOptions = {},
): RerankerProviderRegistry {
  const factories = new Map<string, RerankerProviderFactory>();
  const created: Reranker[] = [];
  const retainCreated = options.retainCreated !== false;

  for (const id of ['heuristic', 'cross-encoder', 'llamacpp'] as const) {
    factories.set(id, {
      id,
      create: (weights, opts) => createReranker(id, weights, opts),
    });
  }

  return {
    /** Test/dev seam; the live singleton only resolves built-ins. */
    register(factory) {
      factories.set(factory.id, factory);
      return () => {
        if (factories.get(factory.id) === factory) factories.delete(factory.id);
      };
    },

    create(id, weights, opts) {
      const factory = factories.get(id);
      if (!factory) return null;
      try {
        const reranker = factory.create(weights, opts);
        if (reranker && retainCreated) created.push(reranker);
        return reranker;
      } catch {
        return null;
      }
    },

    list() {
      return [...factories.keys()];
    },

    dispose() {
      while (created.length > 0) {
        const reranker = created.pop();
        if (reranker) disposeReranker(reranker);
      }
    },
  };
}
