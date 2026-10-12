// V2 ①c: zero-shot NER via GLiNER ONNX (arXiv:2311.08526 — OOD 52.7 F1,
// beats ChatGPT zero-shot NER on 20 datasets). Lazy singleton; the model is
// downloaded on demand to ~/.mafw/models/gliner/; EVERY failure is fail-open
// (null engine → callers skip augmentation). Follows the kokoro
// optional-engine pattern (promise cached, resettable for retry).
//
// Default model: patronus-studio/gliner_small-v2.5-edge (Apache-2.0, ONNX
// int4/int8 quantized export of gliner-community/gliner_small-v2.5, ~50M
// params). Input format per its gliner_onnx_config.json: labels are encoded
// as "<<ENT>> label <<SEP>>" segments that PRECEDE the text segment; span
// logits decode with max_width 12 and a sigmoid threshold.
//
// All heavyweight requires (onnxruntime-node, @huggingface/transformers)
// are dynamic — first getGliner() only — so importing this module stays free.

import * as fs from 'fs';
import * as path from 'path';

export const GLINER_ENT = 128001;
export const GLINER_SEP = 128002;
const CLS = 1;
const SEP = 2;

export interface GlinerSpan { label: string; text: string; score: number }
export interface GlinerEngine { extract(text: string, labels: string[]): Promise<GlinerSpan[]> }

export const DEFAULT_GLINER_MODEL = 'patronus-studio/gliner_small-v2.5-edge';
export const DEFAULT_GLINER_FILE = 'model_int4_embeddings_int8.onnx';

/** Parallel encoding: "<<ENT>> label <<SEP>>" segments precede
 * "[CLS] text [SEP]"-style text segment. Pure + exported for tests. */
export function buildGlinerInput(p: { labelIds: number[]; textIds: number[] }): number[] {
  return [...p.labelIds, ...p.textIds];
}

/** Decode span logits [numLabels][seqLen][seqLen] (flattened). For each
 * label keep the best span (start,end) with start >= textStart and width
 * <= maxWidth; sigmoid(logit) >= threshold emits the span. Pure + exported. */
export function decodeGlinerOutput(
  logits: Float32Array,
  ctx: { seqLen: number; textStart: number; labels: string[]; tokens: string[]; threshold: number; maxWidth: number },
): GlinerSpan[] {
  const { seqLen, textStart, labels, tokens, threshold, maxWidth } = ctx;
  const out: GlinerSpan[] = [];
  for (let li = 0; li < labels.length; li++) {
    let best: { s: number; e: number; logit: number } | null = null;
    for (let s = textStart; s < seqLen; s++) {
      for (let e = s; e < Math.min(s + maxWidth, seqLen); e++) {
        const v = logits[li * seqLen * seqLen + s * seqLen + e];
        if (!best || v > best.logit) best = { s, e, logit: v };
      }
    }
    if (best) {
      const score = 1 / (1 + Math.exp(-best.logit));
      if (score >= threshold) {
        out.push({ label: labels[li], text: tokens.slice(best.s, best.e + 1).join(' ').trim(), score });
      }
    }
  }
  return out;
}

// ── Lazy engine singleton (fail-open) ────────────────────────────────────────

let enginePromise: Promise<GlinerEngine | null> | null = null;

/** Test hook: drop the cached promise so a failed load can retry. */
export function resetGlinerForTest(): void {
  enginePromise = null;
}

function modelDir(): string {
  return path.join(require('os').homedir(), '.mafw', 'models', 'gliner');
}

/** Set by tests to inject a fake engine; production resolves via download. */
let fakeEngine: GlinerEngine | null | undefined;

export function setGlinerForTest(engine: GlinerEngine | null): void {
  fakeEngine = engine;
  resetGlinerForTest();
}

async function downloadModel(model: string, file: string): Promise<string> {
  const dir = modelDir();
  const target = path.join(dir, file);
  if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) return target;
  fs.mkdirSync(dir, { recursive: true });
  const bases = [
    `https://hf-mirror.com/${model}/resolve/main/`,
    `https://huggingface.co/${model}/resolve/main/`,
  ];
  let lastErr: unknown = null;
  for (const base of bases) {
    try {
      const res = await fetch(base + file, { redirect: 'follow' } as any);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1_000_000) throw new Error(`suspiciously small (${buf.length} bytes)`);
      fs.writeFileSync(target + '.tmp', buf);
      fs.renameSync(target + '.tmp', target);
      return target;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('download failed');
}

async function createEngine(): Promise<GlingerEngineImpl | null> {
  // Dynamic requires: onnxruntime-node is a transitive dep of
  // @huggingface/transformers (already installed); transformers provides the
  // DeBERTa-v3 fast tokenizer (tokenizer.json + spm.model).
  const ort: typeof import('onnxruntime-node') = require('onnxruntime-node');
  const { AutoTokenizer }: typeof import('@huggingface/transformers') = require('@huggingface/transformers');
  const model = (global as any).__mafwGlinerModel ?? DEFAULT_GLINER_MODEL;
  const file = DEFAULT_GLINER_FILE;
  const modelPath = await downloadModel(model, file);
  // Tokenizer from the same repo (tokenizer.json is transformer.js-compatible).
  const tokDir = path.join(modelDir(), 'tokenizer');
  for (const f of ['tokenizer.json', 'spm.model', 'tokenizer_config.json']) {
    try { await downloadTo(model, f, path.join(tokDir, f)); } catch { /* tokenizer.json alone is often enough */ }
  }
  const tokenizer = await AutoTokenizer.from_pretrained(tokDir);
  const session = await ort.InferenceSession.create(modelPath);
  return new GlingerEngineImpl(session, tokenizer);
}

async function downloadTo(model: string, file: string, target: string): Promise<void> {
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bases = [
    `https://hf-mirror.com/${model}/resolve/main/`,
    `https://huggingface.co/${model}/resolve/main/`,
  ];
  for (const base of bases) {
    try {
      const res = await fetch(base + file, { redirect: 'follow' } as any);
      if (!res.ok) continue;
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      return;
    } catch { /* try next base */ }
  }
  throw new Error(`download failed: ${file}`);
}

class GlingerEngineImpl implements GlinerEngine {
  constructor(private session: any, private tokenizer: any) {}

  async extract(text: string, labels: string[]): Promise<GlinerSpan[]> {
    if (!text || labels.length === 0) return [];
    const ort: typeof import('onnxruntime-node') = require('onnxruntime-node');
    // Label segment: for each label "<<ENT>> label <<SEP>>".
    const labelIds: number[] = [];
    for (const label of labels) {
      const enc = await this.tokenizer.encode(label);
      const ids = Array.isArray(enc) ? enc : (enc as any).ids ?? [...enc];
      labelIds.push(GLINER_ENT, ...ids.filter((id: number) => id !== CLS && id !== SEP), GLINER_SEP);
    }
    const textEnc = await this.tokenizer.encode(text);
    const textIdsAll = Array.isArray(textEnc) ? textEnc : (textEnc as any).ids ?? [...textEnc];
    const textIds = [CLS, ...textIdsAll.filter((id: number) => id !== CLS && id !== SEP), SEP];
    const inputIds = buildGlinerInput({ labelIds, textIds });
    const textStart = labelIds.length; // index of the text segment's CLS
    const seqLen = inputIds.length;
    const feeds: Record<string, any> = {};
    const names = this.session.inputNames as string[];
    const main = names.find((n: string) => n.includes('input_ids')) ?? names[0];
    const attn = names.find((n: string) => n.includes('attention')) ?? names[1] ?? main;
    const tt = names.find((n: string) => n.includes('token_type')) ?? attn;
    feeds[main] = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, seqLen]);
    if (attn !== main) feeds[attn] = new ort.Tensor('int64', BigInt64Array.from(new Array(seqLen).fill(1n)), [1, seqLen]);
    if (tt !== main && tt !== attn) feeds[tt] = new ort.Tensor('int64', BigInt64Array.from(new Array(seqLen).fill(0n)), [1, seqLen]);
    const results = await this.session.run(feeds);
    const outName = (this.session.outputNames as string[])[0];
    const out = results[outName];
    if (!out || !out.data) return [];
    // Canonical export: [1, seq, seq] span logits (label batch flattened into
    // the first dim when > 1 label — we run one label at a time for v1 to
    // keep the layout unambiguous).
    const data = out.data as Float32Array;
    const tokens: string[] = [];
    for (const id of inputIds) {
      try { tokens.push((this.tokenizer.decode ? this.tokenizer.decode([id]) : String(id)) as string); }
      catch { tokens.push(String(id)); }
    }
    const spans: GlinerSpan[] = [];
    for (let li = 0; li < labels.length; li++) {
      const offset = li * seqLen * seqLen;
      const slice = data.subarray(offset, offset + seqLen * seqLen);
      spans.push(...decodeGlinerOutput(slice, {
        seqLen, textStart: textStart + 1, labels: [labels[li]], tokens, threshold: 0.5, maxWidth: 12,
      }));
    }
    return spans;
  }
}

/** Lazy fail-open accessor. Returns null on ANY failure (download, ort,
 * tokenizer) — callers must treat null as "skip augmentation". */
export async function getGliner(): Promise<GlinerEngine | null> {
  if (fakeEngine !== undefined) return fakeEngine;
  if (!enginePromise) {
    enginePromise = createEngine().catch((err) => {
      const { log } = require('../core/utils/logger');
      log.warn(`[GLiNER] engine unavailable (fail-open): ${err?.message || err}`);
      // Allow a later retry instead of caching the failure forever.
      setImmediate(() => { enginePromise = null; });
      return null;
    });
  }
  return enginePromise;
}
