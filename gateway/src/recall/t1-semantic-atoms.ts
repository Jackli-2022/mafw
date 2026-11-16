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
import {
  cosineSimilarity,
  computeAnchorBaselines,
  selectCalibratedAtoms,
  type SelectAtomOptions,
} from './t1-atom-calibration';
import { DEFAULT_CONCEPT_ALIASES } from './t1-concepts';

export { cosineSimilarity };

export interface SemanticEmbedder {
  embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]>;
}

export interface T1SemanticEncoderOptions {
  /** Legacy raw path; ignored once calibration is active. */
  minCosine?: number;
  /** Legacy raw path; ignored once calibration is active. */
  maxAtoms?: number;
  /** Test seam: override the concept anchors. */
  anchors?: Array<{ termId: string; text: string }>;
  /** Reference population for per-anchor baselines (default: built-in list). */
  referenceTexts?: () => string[];
  /** Test/ops seam: precomputed baselines; skips reference embedding. */
  baselines?: number[];
  /** Selection rule (default: top2 / minScore 0.02 / minTop1 0.05). */
  select?: SelectAtomOptions;
}

/** Generic zh/en sentences used when no real T1 reference population exists. */
export const DEFAULT_REFERENCE_TEXTS = [
  '今天午饭吃什么', '明天天气怎么样', '周末去公园散步', '帮我订一张机票',
  '这个月的账单有点高', '球队昨晚赢了', '电影很好看', '地铁太挤了',
  'the quick brown fox jumps over the lazy dog',
  'lunch menu for tomorrow', 'weather forecast this weekend',
  'book a flight to Tokyo', 'the invoice total is too high',
  'our team won last night', 'the movie was great',
  'the subway is crowded', 'please water the plants',
  'I need to buy groceries', 'the meeting moved to Friday',
  'she painted the kitchen blue', 'the cat is sleeping on the sofa',
  'traffic was terrible this morning', 'my phone battery dies quickly',
  'the recipe needs more salt',
];

export interface AtomCalibrationSnapshot {
  anchors: number;
  referenceCount: number;
  baselines: number[];
}

let calibrationState: AtomCalibrationSnapshot | null = null;

/** Last computed calibration in this process (observability / stats). */
export function getT1AtomCalibration(): AtomCalibrationSnapshot | null {
  return calibrationState
    ? { ...calibrationState, baselines: [...calibrationState.baselines] }
    : null;
}

export function resetT1AtomCalibration(): void {
  calibrationState = null;
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
  private calibration: AtomCalibrationSnapshot | null = null;

  constructor(
    private embedder: SemanticEmbedder,
    private opts: T1SemanticEncoderOptions = {},
  ) {}

  /** Number of cached anchor vectors (observability / tests). */
  get cachedAnchors(): number {
    return this.anchorVectors?.length ?? 0;
  }

  /** This encoder's calibration (null before the first encode). */
  get calibrationSnapshot(): AtomCalibrationSnapshot | null {
    return this.calibration
      ? { ...this.calibration, baselines: [...this.calibration.baselines] }
      : null;
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

  /**
   * Per-anchor baselines, computed once per encoder instance. Reference texts
   * come from the caller (real T1 sample); an empty list falls back to the
   * built-in generic population so a fresh install still calibrates.
   */
  private async ensureCalibration(anchorVectors: number[][]): Promise<number[]> {
    if (this.calibration) return this.calibration.baselines;
    const provided = this.opts.baselines;
    if (provided && provided.length > 0) {
      this.calibration = {
        anchors: anchorVectors.length,
        referenceCount: 0,
        baselines: [...provided],
      };
      calibrationState = this.calibration;
      return this.calibration.baselines;
    }
    const supplied = this.opts.referenceTexts?.() ?? [];
    const referenceTexts = supplied
      .map((text) => String(text ?? '').trim())
      .filter(Boolean)
      .slice(0, 64);
    const population = referenceTexts.length > 0 ? referenceTexts : DEFAULT_REFERENCE_TEXTS;
    const referenceVectors = await this.embedder.embed(population, 'document');
    this.calibration = {
      anchors: anchorVectors.length,
      referenceCount: population.length,
      baselines: computeAnchorBaselines(anchorVectors, referenceVectors),
    };
    calibrationState = this.calibration;
    return this.calibration.baselines;
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
      const baselines = await this.ensureCalibration(anchorVectors);

      for (const batch of chunk(usable, BATCH)) {
        const embedded = await this.embedder.embed(
          batch.map((turn) => turn.text),
          'document',
        );
        batch.forEach((turn, index) => {
          const vector = embedded[index] ?? [];
          const raw = anchors.map((anchor, anchorIndex) => ({
            termId: anchor.termId,
            cosine: cosineSimilarity(vector, anchorVectors[anchorIndex] ?? []),
          }));
          const atoms = selectCalibratedAtoms(raw, baselines, this.opts.select);
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
