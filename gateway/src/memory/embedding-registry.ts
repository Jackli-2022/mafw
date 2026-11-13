// Embedding provider registry.
//
// The live gateway resolves one configured provider through this registry.
// Factories stay lazy: registering a built-in does not download a model or
// spawn a llama-server. Created providers are tracked for LIFO disposal on
// hot-swap.
import { log } from '../core/utils/logger';
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from './embedding-provider';

export interface EmbeddingProviderFactory {
  id: string;
  create(cfg: EmbeddingProviderConfig): EmbeddingProvider | null;
}

export interface EmbeddingProviderRegistry {
  register(factory: EmbeddingProviderFactory): () => void;
  create(id: string, cfg: EmbeddingProviderConfig): EmbeddingProvider | null;
  list(): string[];
  dispose(): void | Promise<void>;
}

export function embeddingProviderIdFromConfig(
  cfg: Pick<EmbeddingProviderConfig, 'provider' | 'engine'>,
): string | null {
  if (cfg.provider === 'off') return null;
  if (cfg.provider === 'dashscope') return 'dashscope';
  if (cfg.provider === 'local') {
    return cfg.engine === 'llamacpp' ? 'local-llamacpp' : 'local-onnx';
  }
  return null;
}

export function disposeEmbeddingProvider(provider: EmbeddingProvider | null | undefined): void {
  if (!provider) return;
  try {
    if (typeof provider.dispose === 'function') {
      void provider.dispose();
      return;
    }
    const legacy = (provider as { killServer?: () => void }).killServer;
    if (typeof legacy === 'function') legacy.call(provider);
  } catch {
    // best effort: a failed dispose must not block a new provider
  }
}

function builtinFactories(): EmbeddingProviderFactory[] {
  return [
    {
      id: 'dashscope',
      create: (cfg) => createEmbeddingProvider({ ...cfg, provider: 'dashscope' }),
    },
    {
      id: 'local-onnx',
      create: (cfg) => createEmbeddingProvider({ ...cfg, provider: 'local', engine: 'onnx' }),
    },
    {
      id: 'local-llamacpp',
      create: (cfg) => createEmbeddingProvider({ ...cfg, provider: 'local', engine: 'llamacpp' }),
    },
  ];
}

export function createEmbeddingProviderRegistry(): EmbeddingProviderRegistry {
  const factories = new Map<string, EmbeddingProviderFactory>();
  const created: EmbeddingProvider[] = [];

  for (const factory of builtinFactories()) factories.set(factory.id, factory);

  return {
    register(factory) {
      factories.set(factory.id, factory);
      return () => {
        if (factories.get(factory.id) === factory) factories.delete(factory.id);
      };
    },

    create(id, cfg) {
      const factory = factories.get(id);
      if (!factory) return null;
      try {
        const provider = factory.create(cfg);
        if (provider) created.push(provider);
        return provider;
      } catch (err: any) {
        log.warn(`[Embedding] provider "${id}" failed to initialize: ${err?.message || err}`);
        return null;
      }
    },

    list() {
      return [...factories.keys()];
    },

    async dispose() {
      while (created.length > 0) {
        const provider = created.pop();
        if (!provider) continue;
        try {
          if (typeof provider.dispose === 'function') {
            await provider.dispose();
          } else {
            const legacy = (provider as { killServer?: () => void }).killServer;
            if (typeof legacy === 'function') legacy.call(provider);
          }
        } catch {
          // best effort; continue disposing the rest
        }
      }
    },
  };
}
