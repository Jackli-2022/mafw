/**
 * Encode-time replay signals (E2): DG novelty + CA1 mismatch.
 *
 * novelty  = 1 − max cosine(content, active cortex memory)
 * mismatch = max(0, max cosine(cue, memory) − max cosine(content, memory))
 *
 * Both are derived scalars used for ordering only; they never gate ingestion
 * and never touch raw T1. Fail-open: any embed/search error yields no score.
 */
export interface TurnSignalInput {
  traceId: string;
  text: string;
  cue: string;
  /** Turn end time in epoch seconds (T1 `last_ts`). */
  lastTs?: number;
  anchorCount: number;
}

export interface TurnSignals {
  novelty: number;
  mismatch: number;
}

export interface TurnSignalUnit {
  createdAt?: string;
  type?: string;
  supersededBy?: string;
  traceIds?: string[];
}

export interface TurnSignalDeps {
  embedder: { embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]> };
  vectors: { searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }> };
  unitFor: (id: string) => TurnSignalUnit | undefined;
}

/** Enough candidates to survive active/self/time filtering. */
const TOP_K = 200;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Agent/system boilerplate: same template, different payload — not a memory cue. */
const SYSTEM_PROMPT = /^(you are (a|an)\b|\[MAFW SYSTEM\]|research task\b|research only\b)/i;

/** Join raw T1 rows without turning structured content into "[object Object]". */
export function normalizeObservationText(rows: Array<{ content?: unknown }>): string {
  return rows
    .map((row) => {
      if (typeof row.content === 'string') return row.content;
      if (row.content == null) return '';
      try {
        return JSON.stringify(row.content);
      } catch {
        return String(row.content);
      }
    })
    .join('\n');
}

/** Short greetings, empty turns and agent boilerplate carry no cue to compare. */
export function isInformativeTurn(text: string, anchorCount: number): boolean {
  const body = String(text ?? '').trim();
  if (!body) return false;
  if (body === '[object Object]') return false;
  if (SYSTEM_PROMPT.test(body)) return false;
  return body.length >= 120 || anchorCount > 0;
}

export function scoreTurnSignals(
  contentSim: number | null,
  cueSim: number | null,
): TurnSignals | null {
  if (contentSim == null || !Number.isFinite(contentSim)) return null;
  const novelty = clamp01(1 - contentSim);
  const mismatch =
    cueSim == null || !Number.isFinite(cueSim) ? 0 : clamp01(cueSim - contentSim);
  return { novelty, mismatch };
}

/** Best similarity among candidates that may legitimately explain this turn. */
function bestCandidateSim(
  input: TurnSignalInput,
  vector: number[],
  deps: TurnSignalDeps,
): number | null {
  let best: number | null = null;
  for (const hit of deps.vectors.searchByCosine(vector, TOP_K)) {
    const unit = deps.unitFor(hit.id);
    if (!unit) continue;
    if (unit.supersededBy) continue;
    if (unit.type === 'episodic') continue;
    if (unit.traceIds?.includes(input.traceId)) continue;
    if (unit.createdAt && input.lastTs != null) {
      const created = Date.parse(unit.createdAt);
      // Never let a memory written after the turn judge that turn.
      if (Number.isFinite(created) && created > input.lastTs * 1000) continue;
    }
    if (!Number.isFinite(hit.cosine)) continue;
    if (best == null || hit.cosine > best) best = hit.cosine;
  }
  return best;
}

export async function computeTurnSignals(
  inputs: TurnSignalInput[],
  deps: TurnSignalDeps,
): Promise<Map<string, TurnSignals>> {
  const scored = new Map<string, TurnSignals>();
  try {
    const eligible = inputs.filter((i) => isInformativeTurn(i.text, i.anchorCount));
    if (eligible.length === 0) return scored;

    const cueTexts = eligible.map((i) => String(i.cue ?? '').trim());
    const cueIndexes = cueTexts
      .map((cue, idx) => (cue ? idx : -1))
      .filter((idx) => idx >= 0);

    // Same embedding kind for cue and content so both live in the memory
    // vector space (unit vectors are indexed as documents).
    const [contentVectors, cueVectors] = await Promise.all([
      deps.embedder.embed(eligible.map((i) => i.text), 'document'),
      cueIndexes.length > 0
        ? deps.embedder.embed(cueIndexes.map((idx) => cueTexts[idx]), 'document')
        : Promise.resolve([] as number[][]),
    ]);

    const cueByIndex = new Map<number, number[]>();
    cueIndexes.forEach((inputIdx, j) => {
      const vector = cueVectors[j];
      if (vector) cueByIndex.set(inputIdx, vector);
    });

    for (let idx = 0; idx < eligible.length; idx++) {
      const input = eligible[idx];
      const contentVector = contentVectors[idx];
      if (!contentVector) continue;
      const contentSim = bestCandidateSim(input, contentVector, deps);
      if (contentSim == null) continue;
      // CA1 comparison needs a real input; short turns have no "details" to
      // diverge, and their generic cue matches everything.
      const cueVector = input.text.trim().length >= 120 ? cueByIndex.get(idx) : undefined;
      const cueSim = cueVector ? bestCandidateSim(input, cueVector, deps) : null;
      const signals = scoreTurnSignals(contentSim, cueSim);
      if (signals) scored.set(input.traceId, signals);
    }
    return scored;
  } catch {
    return new Map();
  }
}
