// Deterministic concept embedding for the T1 baseline.
//
// This is intentionally NOT a real model: the baseline measures the retrieval
// pipeline (FTS vs dense vs fused), not model quality. Concept groups let us
// simulate synonym/paraphrase matching deterministically and offline.
const CONCEPTS: string[][] = [
  ['reflection', 'reflect', '反思', '解析', 'parse', 'unparseable', 'json', 'prompt'],
  ['coverage', 'cover', '覆盖率', 't1', 'vector', 'backfill', 'archive'],
  ['provenance', 'source', 'trace', '来源', '证据', 'source_trace_ids'],
  ['deployment', 'deploy', 'restart', 'gateway', '宕机', '启动', 'health'],
  ['consolidation', 'merge', '合并', 'supersede', 'distinct'],
];

export function embed(text: string): number[] {
  const lower = String(text ?? '').toLowerCase();
  const vec = new Array(CONCEPTS.length).fill(0) as number[];
  for (let i = 0; i < CONCEPTS.length; i++) {
    for (const term of CONCEPTS[i]) {
      if (lower.includes(term.toLowerCase())) vec[i] += 1;
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vec.map((value) => value / norm) : vec;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface FakeVectorRow {
  key: string;
  text: string;
}

/** Minimal in-memory vector store implementing the T1 search contract. */
export function createFakeT1Runtime(rows: FakeVectorRow[]) {
  const vectors = new Map<string, number[]>();
  for (const row of rows) {
    vectors.set(row.key, embed(row.text));
  }
  return {
    provider: {
      async embed(texts: string[], _kind: string): Promise<number[][]> {
        return texts.map((text) => embed(text));
      },
    },
    t1Vectors: {
      searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }> {
        const hits: Array<{ id: string; cosine: number }> = [];
        for (const [id, vector] of vectors) {
          const score = cosine(query, vector);
          if (score > 0) hits.push({ id, cosine: score });
        }
        return hits.sort((a, b) => b.cosine - a.cosine).slice(0, Math.max(0, topK));
      },
    },
  };
}
