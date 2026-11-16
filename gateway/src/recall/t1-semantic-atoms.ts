// Embedding → sparse semantic atoms for T1 episode encode.
//
// This is the "hippocampal" write-time step: an embedding is projected onto a
// small, named anchor dictionary (one anchor per concept alias), and only the
// strongest few atoms survive as sparse terms. It is dictionary sparse coding
// with an interpretable dictionary — not SAE training and not a dense query
// index.
//
// Failure is fail-open: no runtime, no vectors, or a provider error leaves the
// turn with its lexical/concept code and raw T1 intact.
import type { T1SparseAtom } from './t1-sparse';
import { cosineSimilarity } from './t1-atom-calibration';

export { cosineSimilarity };
import { DEFAULT_CONCEPT_ALIASES } from './t1-concepts';

export interface SemanticEmbedder {
  embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]>;
}

export interface T1SemanticEncoderOptions {
  /** Minimum cosine for an atom to survive (default 0.35). */
  minCosine?: number;
  /** Maximum atoms per turn (default 8). */
  maxAtoms?: number;
  /** Test seam: override the concept anchors. */
  anchors?: Array<{ termId: string; text: string }>;
}

export interface SemanticTurnInput {
  traceId: string;
  text: string;
}

const MAX_TEXT = 2000;
const BATCH = 16;

/** One anchor per concept: the first alias is the representative surface form. */
export function buildConceptAnchors(
  aliases: Array<{ term: string; conceptId: string }> = DEFAULT_CONCEPT_ALIASES,
): Array<{ termId: string; text: string }> {
  const seen = new Map<string, string>();
  for (const alias of aliases) {
    if (!seen.has(alias.conceptId)) seen.set(alias.conceptId, alias.term);
  }
  return [...seen.entries()].map(([termId, text]) => ({ termId, text }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class T1SemanticEncoder {
  private anchorVectors: number[][] | null = null;

  constructor(
    private embedder: SemanticEmbedder,
    private opts: T1SemanticEncoderOptions = {},
  ) {}

  /** Number of cached anchor vectors (observability / tests). */
  get cachedAnchors(): number {
    return this.anchorVectors?.length ?? 0;
  }

  private async anchors(): Promise<number[][]> {
    if (this.anchorVectors) return this.anchorVectors;
    const anchors = this.opts.anchors ?? buildConceptAnchors();
    const vectors: number[][] = [];
    for (const batch of chunk(anchors, BATCH)) {
      const embedded = await this.embedder.embed(
        batch.map((anchor) => anchor.text),
        'document',
      );
      vectors.push(...embedded);
    }
    this.anchorVectors = vectors;
    return vectors;
  }

  /** Encode several turns with one anchor pass and batched embedding calls. */
  async encodeMany(turns: SemanticTurnInput[]): Promise<Map<string, T1SparseAtom[]>> {
    const result = new Map<string, T1SparseAtom[]>();
    const usable = (turns ?? [])
      .map((turn) => ({
        traceId: String(turn.traceId ?? ''),
        text: String(turn.text ?? '').trim().slice(0, MAX_TEXT),
      }))
      .filter((turn) => turn.traceId && turn.text);
    if (usable.length === 0) return result;

    try {
      const anchors = this.opts.anchors ?? buildConceptAnchors();
      const anchorVectors = await this.anchors();
      const minCosine = this.opts.minCosine ?? 0.35;
      const maxAtoms = Math.max(1, this.opts.maxAtoms ?? 8);

      for (const batch of chunk(usable, BATCH)) {
        const embedded = await this.embedder.embed(
          batch.map((turn) => turn.text),
          'document',
        );
        batch.forEach((turn, index) => {
          const vector = embedded[index] ?? [];
          const atoms = anchors
            .map((anchor, anchorIndex) => ({
              termId: anchor.termId,
              cosine: cosineSimilarity(vector, anchorVectors[anchorIndex] ?? []),
            }))
            .filter((atom) => Number.isFinite(atom.cosine) && atom.cosine >= minCosine)
            .sort((a, b) => b.cosine - a.cosine)
            .slice(0, maxAtoms)
            .map((atom) => ({ termId: atom.termId, score: atom.cosine }));
          if (atoms.length > 0) result.set(turn.traceId, atoms);
        });
      }
      return result;
    } catch {
      return new Map();
    }
  }
}

const encoderCache = new WeakMap<object, T1SemanticEncoder>();

/**
 * One encoder per provider instance: anchor vectors are stable for the life of
 * the provider and are embedded only once.
 */
export function getT1SemanticEncoder(
  embedder: SemanticEmbedder,
  opts?: T1SemanticEncoderOptions,
): T1SemanticEncoder {
  let encoder = encoderCache.get(embedder as object);
  if (!encoder) {
    encoder = new T1SemanticEncoder(embedder, opts);
    encoderCache.set(embedder as object, encoder);
  }
  return encoder;
}
