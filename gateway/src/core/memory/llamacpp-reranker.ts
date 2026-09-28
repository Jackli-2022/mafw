// llama.cpp cross-encoder reranker via llama-server sidecar.
//
// Qwen3-Reranker-0.6B is a Qwen3ForCausalLM (yes/no logit scoring), not a
// sequence-classification model — it cannot go through transformers.js's
// text-classification pipeline. llama.cpp has native reranking support
// (`--reranking` + POST /rerank), so we reuse the same GGUF sidecar pattern as
// the embedding engine. This is the "verification" layer (CA1 match-mismatch):
// it reads the query AND each candidate together and scores relevance.
//
// Fail-open: any startup/scoring error falls back to the heuristic reranker.

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../utils/logger';
import { Reranker, HeuristicReranker } from './reranker';
import { ScoredEntry } from './harmonic-index';
import { assetNames, pickFreePort, LlamaCppVariant } from '../../memory/llamacpp-provider';

export interface LlamaCppRerankerConfig {
  /** GGUF path, or 'hf:<repo>:<file>' (downloaded from HF_ENDPOINT mirror). */
  modelFile?: string;
  port?: number;
  threads?: number;
  contextSize?: number;
  /** 'cpu' (default) | 'vulkan' | 'cuda'. */
  gpu?: string;
  binaryVersion?: string;
  /** R4 recency-competition weight in the fusion (0 = off, default). */
  recencyWeight?: number;
  deps?: {
    spawnFn?: typeof spawn;
    fetchFn?: typeof fetch;
    binDir?: string;
    modelDir?: string;
  };
}

export const DEFAULT_RERANKER_MODEL =
  'hf:mradermacher/Qwen3-Reranker-0.6B-GGUF:Qwen3-Reranker-0.6B.Q4_K_M.gguf';

const DEFAULT_BINARY_VERSION = 'b10752';
const HEALTH_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 120_000;

function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

// Qwen3-Reranker prompt template (official). The empty think block disables
// Qwen3 thinking mode — without it the model emits <think> instead of yes/no.
const RERANK_INSTRUCT = 'Given a query, retrieve relevant memories that answer the query';
const RERANK_PREFIX =
  '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n';
const RERANK_SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';

function formatRerankPrompt(query: string, doc: string): string {
  return `${RERANK_PREFIX}<Instruct>: ${RERANK_INSTRUCT}\n<Query>: ${query}\n<Document>: ${doc}${RERANK_SUFFIX}`;
}

/** Score = P("yes") / (P("yes") + P("no")) from the next-token top logprobs. */
function scoreFromTopLogprobs(top: Array<{ token: string; logprob: number }>): number {
  const lp = (t: string) => top.find(x => x.token === t)?.logprob;
  const y = lp('yes');
  const n = lp('no');
  if (y === undefined && n === undefined) return 0.5;
  if (y === undefined) return 0;
  if (n === undefined) return 1;
  const py = Math.exp(y);
  const pn = Math.exp(n);
  return py / (py + pn);
}

export class LlamaCppReranker implements Reranker {
  name = 'llamacpp';
  private cfg: LlamaCppRerankerConfig;
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private baseUrl: string | null = null;
  private fallback = new HeuristicReranker();
  private exitHookRegistered = false;

  constructor(opts: LlamaCppRerankerConfig = {}) {
    this.cfg = opts;
  }

  private binDir(): string {
    return this.cfg.deps?.binDir ?? path.join(os.homedir(), '.mafw', 'bin', 'llama.cpp');
  }
  private modelDir(): string {
    return this.cfg.deps?.modelDir ?? path.join(os.homedir(), '.mafw', 'models', 'gguf');
  }
  private variant(): LlamaCppVariant {
    if (this.cfg.gpu === 'vulkan') return 'vulkan';
    if (this.cfg.gpu === 'cuda') return 'cuda';
    return 'cpu';
  }

  private async ensureBinary(): Promise<string> {
    const version = this.cfg.binaryVersion || DEFAULT_BINARY_VERSION;
    const asset = assetNames(this.variant(), version);
    if (!asset) throw new Error(`llama.cpp binary: unsupported platform ${process.platform}/${process.arch}/${this.variant()}`);
    const dir = path.join(this.binDir(), version, this.variant());
    const exe = path.join(dir, asset.exe);
    if (fs.existsSync(exe)) return exe;
    throw new Error(`llama-server binary not found: ${exe}`);
  }

  private async ensureModel(): Promise<string> {
    const spec = this.cfg.modelFile || DEFAULT_RERANKER_MODEL;
    if (!spec.startsWith('hf:')) {
      if (!fs.existsSync(spec)) throw new Error(`llama.cpp reranker model not found: ${spec}`);
      return spec;
    }
    const [, repo, file] = spec.split(':');
    const dest = path.join(this.modelDir(), file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100 * 1048576) return dest;
    fs.mkdirSync(this.modelDir(), { recursive: true });
    const base = (process.env.HF_ENDPOINT || 'https://hf-mirror.com').replace(/\/$/, '');
    const url = `${base}/${repo}/resolve/main/${file}`;
    log.info(`[LlamaReranker] downloading model: ${url}`);
    const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
    const resp = await fetchFn(url, { redirect: 'follow' } as any);
    if (!resp.ok) throw new Error(`model download HTTP ${resp.status}`);
    fs.writeFileSync(dest + '.tmp', Buffer.from(await resp.arrayBuffer()));
    fs.renameSync(dest + '.tmp', dest);
    return dest;
  }

  /** Warm up the sidecar (public so the eval harness can pre-start it). */
  async ensureServer(): Promise<string> {
    if (this.baseUrl && this.child && !this.child.killed) return this.baseUrl;
    if (this.starting) return this.starting.then(() => this.baseUrl as string);
    this.starting = (async () => {
      const exe = await this.ensureBinary();
      const model = await this.ensureModel();
      const port = this.cfg.port && this.cfg.port > 0 ? this.cfg.port : await pickFreePort();
      const threads = Math.max(1, this.cfg.threads ?? 2);
      const ctxSize = Math.max(256, this.cfg.contextSize ?? 4096);
      const spawnFn = this.cfg.deps?.spawnFn ?? spawn;
      this.child = spawnFn(exe, [
        '-m', model,
        '--port', String(port),
        '--host', '127.0.0.1',
        '-c', String(ctxSize),
        '-b', String(ctxSize),
        '-ub', String(ctxSize),
        '-t', String(threads),
        ...(this.variant() === 'cpu' ? [] : ['-ngl', '99']),
        '-fa', 'on',
        '-np', '1',
        '--no-warmup',
        '-cram', '0',
        '--reranking',
        '--log-disable',
      ], { windowsHide: true, stdio: 'ignore' });
      this.child.on('exit', code => {
        log.warn(`[LlamaReranker] server exited (code ${code}) — next rerank restarts it`);
        this.child = null;
        this.baseUrl = null;
        this.starting = null;
      });
      if (!this.exitHookRegistered) {
        this.exitHookRegistered = true;
        process.once('exit', () => this.killServer());
      }
      const url = `http://127.0.0.1:${port}`;
      const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      for (;;) {
        try {
          const resp = await fetchFn(`${url}/health`);
          if (resp.ok) break;
        } catch { /* not up yet */ }
        if (Date.now() > deadline) throw new Error('llama-server (rerank) health check timed out');
        await new Promise(r => setTimeout(r, 500));
      }
      this.baseUrl = url;
      log.info(`[LlamaReranker] ready on :${port} (threads=${threads}, ctx=${ctxSize}, variant=${this.variant()})`);
    })().catch(err => {
      this.starting = null;
      this.killServer();
      throw err;
    });
    return this.starting.then(() => this.baseUrl as string);
  }

  killServer(): void {
    const child = this.child;
    this.child = null;
    this.baseUrl = null;
    if (!child || child.killed || child.pid == null) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch { /* best effort */ }
  }

  /**
   * Raw relevance probabilities P("yes") per candidate, in INPUT order — no
   * fusion, no reordering. Reranker-only observability used by the R5 FOK
   * feature probe (the trained cross-encoder is a relevance judge, so its
   * top-1 probability is a candidate feeling-of-knowing signal). Throws when
   * the sidecar is unavailable (callers decide the fallback).
   */
  async scoreCandidates(query: string, candidates: ScoredEntry[]): Promise<number[]> {
    if (candidates.length === 0) return [];
    const baseUrl = await this.ensureServer();
    return this.scoreAll(baseUrl, query, candidates);
  }

  private async scoreAll(baseUrl: string, query: string, candidates: ScoredEntry[]): Promise<number[]> {
    const docs = candidates.map(c =>
      `${c.entry.primary_abstraction} ${(c.entry.cue_anchors || []).join(' ')}`.slice(0, 1200),
    );
    const prompts = docs.map(d => formatRerankPrompt(query, d));
    const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let data: any;
    try {
      // Score all candidates in one batched completion (prompt array → n choices).
      const resp = await fetchFn(`${baseUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompts, max_tokens: 1, temperature: 0, logprobs: 20 }),
        signal: controller.signal,
      } as any);
      if (!resp.ok) throw new Error(`llama-server completions HTTP ${resp.status}`);
      data = await resp.json();
    } finally {
      clearTimeout(timer);
    }
    const ceScores = new Array(candidates.length).fill(0.5);
    for (const ch of data?.choices || []) {
      const top = ch?.logprobs?.content?.[0]?.top_logprobs || [];
      if (typeof ch.index === 'number' && ch.index >= 0 && ch.index < ceScores.length) {
        ceScores[ch.index] = scoreFromTopLogprobs(top);
      }
    }
    return ceScores;
  }

  /**
   * Rerank AND return the raw per-candidate relevance probabilities, from ONE
   * scoring pass. R5 FOK consumes the same probabilities the reranker already
   * computed — calling scoreCandidates separately doubled the GPU cost (~115ms)
   * of every background snapshot build and starved the boundary path.
   * Returns null when the sidecar is unavailable (caller falls back).
   */
  async rerankDetailed(
    query: string,
    candidates: ScoredEntry[],
    topK: number,
  ): Promise<{ scored: ScoredEntry[]; probs: number[] } | null> {
    if (candidates.length === 0) return { scored: [], probs: [] };
    let baseUrl: string;
    let ceScores: number[];
    try {
      baseUrl = await this.ensureServer();
      ceScores = await this.scoreAll(baseUrl, query, candidates);
    } catch (err: any) {
      log.warn(`[LlamaReranker] detailed scoring unavailable: ${err?.message || err}`);
      return null;
    }
    const normCe = normalize(ceScores);
    const normBm25 = normalize(candidates.map(c => c.score));
    const recencyWeight = Math.max(0, Math.min(1, Number(process.env.MAFW_RERANKER_RECENCY ?? this.cfg.recencyWeight ?? 0) || 0));
    const recency = normalize(candidates.map(c => {
      const t = c.entry.created_at ? Date.parse(c.entry.created_at) : NaN;
      return Number.isNaN(t) ? 0 : t;
    }));
    const base = (1 - recencyWeight) / 2;
    const fused = candidates.map((c, i) => ({
      ...c,
      fusedScore: base * normBm25[i] + base * normCe[i] + recencyWeight * recency[i],
    }));
    fused.sort((a, b) => b.fusedScore - a.fusedScore);
    return {
      scored: fused.slice(0, topK).map(({ entry, score }) => ({ entry, score })),
      probs: ceScores,
    };
  }

  async rerank(query: string, candidates: ScoredEntry[], topK: number): Promise<ScoredEntry[]> {
    if (candidates.length === 0) return [];
    let baseUrl: string;
    try {
      baseUrl = await this.ensureServer();
    } catch (err: any) {
      log.warn(`[LlamaReranker] server unavailable, falling back to heuristic: ${err?.message || err}`);
      return this.fallback.rerank(query, candidates, topK);
    }

    let ceScores: number[];
    try {
      ceScores = await this.scoreAll(baseUrl, query, candidates);
    } catch (err: any) {
      log.warn(`[LlamaReranker] scoring failed, falling back to heuristic: ${err?.message || err}`);
      return this.fallback.rerank(query, candidates, topK);
    }

    const normCe = normalize(ceScores);
    const normBm25 = normalize(candidates.map(c => c.score));
    // R4 competition/inhibition (retrieval-induced forgetting analog): among
    // competing candidates, the more RECENT one wins (the latest value of a
    // fact should beat older/competing sessions). Weight 0 = pure R3 baseline.
    const recencyWeight = Math.max(0, Math.min(1, Number(process.env.MAFW_RERANKER_RECENCY ?? this.cfg.recencyWeight ?? 0) || 0));
    const recency = normalize(candidates.map(c => {
      const t = c.entry.created_at ? Date.parse(c.entry.created_at) : NaN;
      return Number.isNaN(t) ? 0 : t;
    }));
    const base = (1 - recencyWeight) / 2;
    const fused = candidates.map((c, i) => ({
      ...c,
      fusedScore: base * normBm25[i] + base * normCe[i] + recencyWeight * recency[i],
    }));
    fused.sort((a, b) => b.fusedScore - a.fusedScore);
    return fused.slice(0, topK).map(({ entry, score }) => ({ entry, score }));
  }
}
