// Embedding namespace identity: modelTag + dims + version.
//
// Vectors are derived data. A provider change must never mix embedding spaces:
// the model tag names the vector file, dims are validated on load, and the
// legacy `vectors-<modelTag>.json` filename is preserved so existing installs
// keep their vectors.
import * as path from 'path';
import type { EmbeddingProvider } from './embedding-provider';

export const EMBEDDING_NAMESPACE_VERSION = 1;
export const DEFAULT_MAX_INPUT_TOKENS = 8192;
export const DEFAULT_BATCH_LIMIT = 16;

export interface EmbeddingProviderMeta {
  modelTag: string;
  dims: number;
  maxInputTokens: number;
  batchLimit: number;
  version: number;
}

export interface EmbeddingNamespace {
  modelTag: string;
  dims: number;
  version: number;
  vectorFile: string;
  t1JsonFile: string;
}

export function sanitizeModelTag(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[._-]+/, '');
  return safe || 'provider';
}

export function embeddingProviderMeta(
  provider: Pick<EmbeddingProvider, 'name' | 'dims' | 'modelTag' | 'maxInputTokens' | 'batchLimit'>,
): EmbeddingProviderMeta {
  return {
    modelTag: sanitizeModelTag(provider.modelTag ?? provider.name),
    dims: provider.dims,
    maxInputTokens: provider.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
    batchLimit: provider.batchLimit ?? DEFAULT_BATCH_LIMIT,
    version: EMBEDDING_NAMESPACE_VERSION,
  };
}

export function resolveEmbeddingNamespace(
  baseDir: string,
  provider: Pick<EmbeddingProvider, 'name' | 'dims' | 'modelTag'>,
): EmbeddingNamespace {
  const meta = embeddingProviderMeta(provider);
  return {
    modelTag: meta.modelTag,
    dims: meta.dims,
    version: meta.version,
    vectorFile: path.join(baseDir, 'memory', `vectors-${meta.modelTag}.json`),
    t1JsonFile: path.join(baseDir, 'memory', `vectors-t1-${meta.modelTag}.json`),
  };
}

export function assertEmbeddingDims(expected: number, actual: number, label: string): void {
  if (expected !== actual) {
    throw new Error(`embedding provider "${label}" declares dims ${expected}, got ${actual}`);
  }
}
