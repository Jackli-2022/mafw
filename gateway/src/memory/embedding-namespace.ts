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
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[._-]+/, '');
}

/** 32-bit FNV-1a; only used to disambiguate lossy sanitization. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function modelTagOf(
  provider: Pick<EmbeddingProvider, 'name' | 'modelTag'>,
): string {
  const raw = provider.modelTag ?? provider.name;
  const safe = sanitizeModelTag(raw);
  // Built-ins pass an explicit modelTag and keep their legacy filenames.
  // New providers whose raw id had to be rewritten get a short hash so
  // `a/b` and `a_b` cannot share one vector namespace.
  if (provider.modelTag !== undefined || safe === raw) return safe;
  return safe ? `${safe}-${shortHash(raw)}` : '';
}

export function embeddingProviderMeta(
  provider: Pick<EmbeddingProvider, 'name' | 'dims' | 'modelTag' | 'maxInputTokens' | 'batchLimit'>,
): EmbeddingProviderMeta {
  const modelTag = modelTagOf(provider);
  if (!modelTag) throw new Error('embedding provider name is required');
  return {
    modelTag,
    dims: provider.dims,
    maxInputTokens: provider.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
    batchLimit: provider.batchLimit ?? DEFAULT_BATCH_LIMIT,
    version: EMBEDDING_NAMESPACE_VERSION,
  };
}

/**
 * A vector file that already exists in another dims/version namespace must not
 * be overwritten by the new namespace. The suffixed path keeps the legacy
 * unsuffixed file intact so rolling back to the old provider can reuse it.
 */
export function namespacedVectorPath(filePath: string, dims: number, version: number): string {
  if (/-d\d+-v\d+\.json$/i.test(filePath)) return filePath;
  return filePath.replace(/\.json$/i, `-d${dims}-v${version}.json`);
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
