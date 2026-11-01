/**
 * Pure model for the Config page's "Memory embedding" card.
 *
 * Extracted so the draft/payload/dirty rules are testable: they mix string
 * inputs (text fields) with numbers from the gateway state, and any mismatch
 * silently disables the Save button or ships `"512"` where the gateway wants
 * an integer.
 */

export const DEFAULT_CONTEXT_SIZE = 2048;
/** Matches memory.embedding.llamacpp.batchSize on the gateway side. */
export const DEFAULT_BATCH_SIZE = 256;
/** Must line up with /api/memory/embedding-config validation (32..32768). */
export const BATCH_MIN = 32;
export const BATCH_MAX = 32768;

export interface EmbeddingLlamacppState {
  gpu?: string;
  contextSize?: number;
  batchSize?: number;
}

export interface EmbeddingState {
  provider?: string;
  engine?: string;
  threads?: number;
  llamacpp?: EmbeddingLlamacppState;
}

export interface EmbeddingDraft {
  provider: string;
  engine: string;
  gpu: string;
  /** Text inputs keep whatever the user typed; parsing happens on save. */
  threads: number | string;
  contextSize: number | string;
  batchSize: number | string;
}

export interface EmbeddingUpdatePayload {
  provider: EmbeddingProviderId;
  engine: EmbeddingEngineId;
  threads: number;
  llamacpp: {
    gpu: string;
    contextSize: number;
    batchSize: number;
  };
}

export type EmbeddingProviderId = 'off' | 'local' | 'dashscope';
export type EmbeddingEngineId = 'onnx' | 'llamacpp';

/** Gateway state is typed loosely over the wire; narrow to what the API accepts. */
function asProvider(v: string): EmbeddingProviderId {
  return v === 'local' || v === 'dashscope' ? v : 'off';
}

function asEngine(v: string): EmbeddingEngineId {
  return v === 'llamacpp' ? 'llamacpp' : 'onnx';
}

export function embeddingDraftFromState(state: EmbeddingState | null | undefined): EmbeddingDraft {
  return {
    provider: state?.provider ?? 'off',
    engine: state?.engine ?? 'onnx',
    gpu: state?.llamacpp?.gpu ?? 'cpu',
    threads: state?.threads ?? 2,
    contextSize: state?.llamacpp?.contextSize ?? DEFAULT_CONTEXT_SIZE,
    batchSize: state?.llamacpp?.batchSize ?? DEFAULT_BATCH_SIZE,
  };
}

export function embeddingDraftDirty(
  draft: EmbeddingDraft | null | undefined,
  state: EmbeddingState | null | undefined,
): boolean {
  if (!draft || !state) return false;
  return draft.provider !== state.provider
    || draft.engine !== state.engine
    || draft.gpu !== (state.llamacpp?.gpu ?? 'cpu')
    || Number(draft.threads) !== state.threads
    || Number(draft.contextSize) !== (state.llamacpp?.contextSize ?? DEFAULT_CONTEXT_SIZE)
    || Number(draft.batchSize) !== (state.llamacpp?.batchSize ?? DEFAULT_BATCH_SIZE);
}

export function embeddingUpdatePayload(draft: EmbeddingDraft): EmbeddingUpdatePayload {
  return {
    provider: asProvider(draft.provider),
    engine: asEngine(draft.engine),
    threads: Number(draft.threads),
    llamacpp: {
      gpu: draft.gpu,
      contextSize: Number(draft.contextSize),
      batchSize: normalizeBatchSize(draft.batchSize),
    },
  };
}

/** Clamp to the gateway's accepted range; NaN/empty falls back to `fallback`. */
export function normalizeBatchSize(raw: number | string, fallback: number = DEFAULT_BATCH_SIZE): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (!Number.isFinite(n) || n === 0) return fallback;
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, Math.round(n)));
}
