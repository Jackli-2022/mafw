import * as os from 'os';
import * as path from 'path';
import { ScoredEntry } from './harmonic-index';

// Prefer domestic mirror on Windows/China networks unless explicitly configured.
if (typeof process !== 'undefined') {
  process.env.HF_ENDPOINT = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
  process.env.HF_HOME = process.env.HF_HOME || path.join(os.homedir(), '.mafw', 'models', 'huggingface');
}

export interface Reranker {
  name: string;
  /** Rerank candidates and return at most topK entries. */
  rerank(query: string, candidates: ScoredEntry[], topK: number): ScoredEntry[] | Promise<ScoredEntry[]>;
}

export interface RerankWeights {
  bm25: number;
  recency: number;
  energy: number;
  salience: number;
}

export interface HeuristicRerankerOptions {
  weights?: Partial<RerankWeights>;
  cutoffRatio?: number;
}

function minMax(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function normalize(values: number[]): number[] {
  const { min, max } = minMax(values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

function parseDate(d?: string): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Zero-dependency reranker that fuses BM25 score with intra-candidate recency,
 * energy, and salience. Recency is computed relative to the candidate set so it
 * still works when every memory is old (e.g. LongMemEval haystacks from 2023).
 */
export class HeuristicReranker implements Reranker {
  name = 'heuristic';
  private weights: RerankWeights;
  private cutoffRatio: number;

  constructor(opts: HeuristicRerankerOptions = {}) {
    this.weights = {
      bm25: opts.weights?.bm25 ?? 0.6,
      recency: opts.weights?.recency ?? 0.2,
      energy: opts.weights?.energy ?? 0.1,
      salience: opts.weights?.salience ?? 0.1,
    };
    this.cutoffRatio = opts.cutoffRatio ?? 0.3;
  }

  rerank(_query: string, candidates: ScoredEntry[], topK: number): ScoredEntry[] {
    if (candidates.length === 0) return [];

    const bm25Scores = candidates.map(c => c.score);
    const normBm25 = normalize(bm25Scores);

    const dates = candidates.map(c => parseDate(c.entry.created_at));
    const validDates = dates.filter((d): d is Date => d !== null);
    let recency: number[];
    if (validDates.length >= 2) {
      const minT = Math.min(...validDates.map(d => d.getTime()));
      const maxT = Math.max(...validDates.map(d => d.getTime()));
      recency = dates.map(d => {
        if (!d) return 0.5;
        if (maxT === minT) return 0.5;
        return (d.getTime() - minT) / (maxT - minT);
      });
    } else {
      recency = candidates.map(() => 0.5);
    }

    const energies = candidates.map(c => c.entry.energy ?? 0.5);
    const saliences = candidates.map(c => {
      const s = c.entry.salience;
      return s === undefined ? 1.0 : s;
    });
    const normSalience = normalize(saliences);

    const fused = candidates.map((c, i) => ({
      ...c,
      fusedScore:
        this.weights.bm25 * normBm25[i] +
        this.weights.recency * recency[i] +
        this.weights.energy * energies[i] +
        this.weights.salience * normSalience[i],
    }));

    fused.sort((a, b) => b.fusedScore - a.fusedScore);

    const threshold = this.cutoffRatio > 0 && fused.length > 0
      ? fused[0].fusedScore * this.cutoffRatio
      : -Infinity;
    const kept = fused.filter(c => c.fusedScore >= threshold);

    return kept.slice(0, topK).map(({ entry, score }) => ({ entry, score }));
  }
}

/**
 * Optional local semantic reranker (bi-encoder cosine via @xenova/transformers).
 * Uses all-MiniLM-L6-v2 (feature-extraction) to score query×memory semantic
 * similarity, fused 50/50 with BM25. Falls back to HeuristicReranker when the
 * dependency or model is unavailable.
 *
 * NOTE: true cross-encoders are not usable here — ms-marco-MiniLM-L6-v2 is
 * absent from hf-mirror, and @xenova/transformers v2's text-classification does
 * not implement cross-encoder pair semantics (flat non-discriminative scores).
 * Bi-encoder cosine still captures paraphrase/semantic overlap BM25 misses.
 */
export class CrossEncoderReranker implements Reranker {
  name = 'semantic';
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private extractor: any = null;
  private fallback = new HeuristicReranker();
  private loading: Promise<void> | null = null;

  constructor() {}

  private async ensureExtractor(): Promise<void> {
    if (this.extractor) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const mod: any = await new Function('spec', 'return import(spec)')('@xenova/transformers');
        // transformers.js v2 does not read HF_ENDPOINT; point remoteHost at the
        // mirror explicitly so model download works on CN networks.
        mod.env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com/';
        this.extractor = await mod.pipeline('feature-extraction', this.modelName);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[CrossEncoderReranker] failed to load ${this.modelName}, falling back to heuristic: ${err.message}`);
      }
    })();
    return this.loading;
  }

  private cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async rerank(query: string, candidates: ScoredEntry[], topK: number): Promise<ScoredEntry[]> {
    await this.ensureExtractor();
    if (!this.extractor) {
      return this.fallback.rerank(query, candidates, topK);
    }
    if (candidates.length === 0) return [];

    const texts = [query, ...candidates.map(c => c.entry.primary_abstraction + ' ' + (c.entry.cue_anchors || []).join(' '))];
    const out = await this.extractor(texts, { pooling: 'mean', normalize: true });
    // v2 feature-extraction returns a single Tensor: dims=[n, dim], data flat.
    const dim = out?.dims?.[1] ?? 0;
    const flat = out?.data as Float32Array | undefined;
    const vecs: Float32Array[] = [];
    if (flat && dim > 0) {
      for (let i = 0; i < out.dims[0]; i++) {
        vecs.push(flat.slice(i * dim, (i + 1) * dim));
      }
    }
    const qVec = vecs[0];
    const sims = qVec ? vecs.slice(1).map(v => this.cosine(qVec, v)) : candidates.map(() => 0);

    // Fuse semantic similarity with original BM25 score (both min-max normalized).
    const normBm25 = normalize(candidates.map(c => c.score));
    const normSim = normalize(sims);
    const fused = candidates.map((c, i) => ({
      ...c,
      fusedScore: 0.5 * normBm25[i] + 0.5 * normSim[i],
    }));

    fused.sort((a, b) => b.fusedScore - a.fusedScore);
    return fused.slice(0, topK).map(({ entry, score }) => ({ entry, score }));
  }
}

export function createReranker(name: 'off' | 'heuristic' | 'cross-encoder', weights?: Partial<RerankWeights>): Reranker | null {
  if (name === 'off') return null;
  if (name === 'heuristic') return new HeuristicReranker({ weights });
  return new CrossEncoderReranker();
}

/**
 * Apply a (possibly async) reranker to scored candidates and truncate.
 * Handles optional post-rerank cutoff.
 */
export async function applyReranker(
  query: string,
  candidates: ScoredEntry[],
  reranker: Reranker,
  topK: number,
  cutoffRatio = 0,
): Promise<ScoredEntry[]> {
  let scored = await Promise.resolve(reranker.rerank(query, candidates, topK));
  if (cutoffRatio > 0 && scored.length > 0) {
    const threshold = scored[0].score * cutoffRatio;
    scored = scored.filter(s => s.score >= threshold);
  }
  return scored.slice(0, topK);
}

