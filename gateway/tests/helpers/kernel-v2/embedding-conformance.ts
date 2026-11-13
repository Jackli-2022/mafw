import type { EmbeddingProvider } from '../../../src/memory/embedding-provider';
import { embeddingProviderMeta } from '../../../src/memory/embedding-namespace';

const HEALTH = new Set(['healthy', 'degraded', 'failed']);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runEmbeddingConformance(provider: EmbeddingProvider): Promise<string[]> {
  const errors: string[] = [];
  if (typeof provider.name !== 'string' || provider.name.trim() === '') {
    errors.push('name is required');
  }
  let meta: ReturnType<typeof embeddingProviderMeta> | null = null;
  try {
    meta = embeddingProviderMeta(provider);
  } catch (err) {
    errors.push(messageOf(err));
  }
  if (meta) {
    if (!meta.modelTag) errors.push('modelTag is required');
    if (!Number.isInteger(meta.maxInputTokens) || meta.maxInputTokens <= 0) {
      errors.push('maxInputTokens must be a positive integer');
    }
    if (!Number.isInteger(meta.batchLimit) || meta.batchLimit <= 0) {
      errors.push('batchLimit must be a positive integer');
    }
  }
  if (!Number.isInteger(provider.dims) || provider.dims <= 0) {
    errors.push('dims must be a positive integer');
  }

  try {
    const query = await provider.embed(['alpha'], 'query');
    if (!Array.isArray(query) || query.length !== 1) {
      errors.push('query embed must return exactly one vector');
    } else if (!Array.isArray(query[0]) || query[0].length !== provider.dims) {
      errors.push(`query vector length must equal dims (${provider.dims})`);
    } else if (!query[0].every((value) => Number.isFinite(value))) {
      errors.push('query vector must contain finite numbers');
    }
  } catch (err) {
    errors.push(`query embed threw: ${messageOf(err)}`);
  }

  try {
    const docs = await provider.embed(['alpha', 'beta'], 'document');
    if (!Array.isArray(docs) || docs.length !== 2) {
      errors.push('document embed must return one vector per text');
    } else {
      for (const vector of docs) {
        if (!Array.isArray(vector) || vector.length !== provider.dims) {
          errors.push(`document vector length must equal dims (${provider.dims})`);
          break;
        }
        if (!vector.every((value) => Number.isFinite(value))) {
          errors.push('document vector must contain finite numbers');
          break;
        }
      }
    }
  } catch (err) {
    errors.push(`document embed threw: ${messageOf(err)}`);
  }

  if (typeof provider.health === 'function') {
    try {
      const health = provider.health();
      if (!HEALTH.has(health)) errors.push(`health returned "${health}"`);
    } catch (err) {
      errors.push(`health threw: ${messageOf(err)}`);
    }
  }

  return errors;
}
