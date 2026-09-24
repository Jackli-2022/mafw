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
 * Optional local cross-encoder reranker (bge-reranker-base via @huggingface/transformers v4).
 * Uses text-classification pipeline with proper pair semantics for query×memory scoring.
 * Falls back to HeuristicReranker when the dependency or model is unavailable.
 *
 * v4 supports HF_ENDPOINT env var natively (no manual env.remoteHost hack needed).
 */
export class CrossEncoderReranker implements Reranker {
  name = 'cross-encoder';
  private modelName = 'Xenova/bge-reranker-base';
  private classifier: any = null;
  private tokenizer: any = null;
  private model: any = null;
  private fallback = new HeuristicReranker();
  private loading: Promise<void> | null = null;

  constructor() {}

  private async ensureClassifier(): Promise<void> {
    if (this.classifier) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const mod: any = await new Function('spec', 'return import(spec)')('@huggingface/transformers');
        // v4 has env.remoteHost but doesn't auto-read HF_ENDPOINT; set it manually
        mod.env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com/';
        const pipe = await mod.pipeline('text-classification', this.modelName);
        // The v4 text-classification pipeline `_call` does NOT forward text_pair
        // to the tokenizer, so query×doc pairs cannot go through `pipe(...)`.
        // Keep the pipeline for model/tokenizer access and drive them directly.
        this.classifier = pipe;
        this.tokenizer = pipe.tokenizer;
        this.model = pipe.model;
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[CrossEncoderReranker] failed to load ${this.modelName}, falling back to heuristic: ${err.message}`);
      }
    })();
    return this.loading;
  }

  async rerank(query: string, candidates: ScoredEntry[], topK: number): Promise<ScoredEntry[]> {
    await this.ensureClassifier();
    if (!this.classifier) {
      return this.fallback.rerank(query, candidates, topK);
    }
    if (candidates.length === 0) return [];

    // Cross-encoder: encode (query, doc) as a token pair in one forward pass.
    const queries = candidates.map(() => query);
    const docs = candidates.map(c => c.entry.primary_abstraction + ' ' + (c.entry.cue_anchors || []).join(' '));
    let ceScores: number[];
    try {
      const inputs = this.tokenizer(queries, { text_pair: docs, padding: true, truncation: true });
      const outputs = await this.model(inputs);
      const logits: number[][] = outputs.logits.tolist();
      // bge-reranker is a 2-class model: softmax(row)[1] = relevance.
      ceScores = logits.map((row) => {
        const m = Math.max(...row);
        const exps = row.map(v => Math.exp(v - m));
        const sum = exps.reduce((a, b) => a + b, 0) || 1;
        return exps[1] / sum;
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`[CrossEncoderReranker] scoring failed, falling back to heuristic: ${err.message}`);
      return this.fallback.rerank(query, candidates, topK);
    }

    // Fuse cross-encoder score with original BM25 score (both min-max normalized).
    const normBm25 = normalize(candidates.map(c => c.score));
    const normCe = normalize(ceScores);
    const fused = candidates.map((c, i) => ({
      ...c,
      fusedScore: 0.5 * normBm25[i] + 0.5 * normCe[i],
    }));

    fused.sort((a, b) => b.fusedScore - a.fusedScore);
    return fused.slice(0, topK).map(({ entry, score }) => ({ entry, score }));
  }
}

export function createReranker(
  name: 'off' | 'heuristic' | 'cross-encoder' | 'llamacpp',
  weights?: Partial<RerankWeights>,
  llamacppOpts?: import('./llamacpp-reranker').LlamaCppRerankerConfig,
): Reranker | null {
  if (name === 'off') return null;
  if (name === 'heuristic') return new HeuristicReranker({ weights });
  if (name === 'llamacpp') {
    // Lazy require breaks the reranker ⇄ llamacpp-reranker import cycle.
    const { LlamaCppReranker } = require('./llamacpp-reranker');
    return new LlamaCppReranker(llamacppOpts ?? {});
  }
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

