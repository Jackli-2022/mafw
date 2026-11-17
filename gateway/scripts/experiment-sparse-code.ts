/**
 * Experiment: is the 12-anchor concept tagger actually a sparse code?
 *
 * Compares three codes on the same turns:
 *   A. current: 12 concept anchors + baseline correction + top2
 *   B. direct k-WTA over the 1024-d embedding (top 16)
 *   C. random expansion (1024 -> 4096) + k-WTA (top 16)
 *
 * Metrics: adjacent-turn vs random-turn Jaccard, and top-1 neighbour
 * same-episode rate. Read-only; no writes.
 *
 * Run from gateway/:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/experiment-sparse-code.ts
 */
import * as os from 'os';
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { buildConceptAnchors } from '../src/recall/t1-semantic-atoms';
import {
  computeAnchorBaselines,
  cosineSimilarity,
  selectCalibratedAtoms,
} from '../src/recall/t1-atom-calibration';
import { normalizeObservationText } from '../src/recall/t1-signals';

const SESSIONS = 60;
const TURNS_PER_SESSION = 4;
const OUT_DIM = 4096;
const TOP_K = 16;

function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function expand(vec: number[] | Float32Array): Float32Array {
  const out = new Float32Array(OUT_DIM);
  for (let i = 0; i < vec.length; i++) {
    const value = vec[i];
    if (!value) continue;
    for (let k = 0; k < 4; k++) {
      const idx = hash32(i * 2654435761 + k * 97) % OUT_DIM;
      out[idx] += (hash32(i + k * 31) & 1 ? -value : value);
    }
  }
  return out;
}

function kwta(vec: number[] | Float32Array, k: number): Set<number> {
  const idx = Array.from({ length: vec.length }, (_, i) => i);
  idx.sort((a, b) => Math.abs(vec[b]) - Math.abs(vec[a]));
  return new Set(idx.slice(0, k));
}

function jaccard(a: Set<string | number>, b: Set<string | number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const db = new GatewayDatabase(path.join(config.resolvePath('memory'), 'gateway.db'));
  const rt = initEmbeddingRuntime({
    baseDir: path.join(os.tmpdir(), 'mafw-sparse-experiment'),
    cfg: config.memory.embedding,
  });
  if (!rt?.provider) {
    console.error('embedding runtime unavailable');
    process.exit(1);
  }

  // Pick sessions with enough turns, then take a contiguous block (adjacent pairs stay adjacent).
  const sessions = (db.getStore()
    .prepare(
      `SELECT session_id, COUNT(*) n FROM t1_turns GROUP BY session_id
        HAVING n >= ? ORDER BY n DESC LIMIT ?`,
    )
    .all(TURNS_PER_SESSION, SESSIONS) as Array<{ session_id: string }>).map((r) => r.session_id);

  const turns: Array<{ sessionId: string; turnSeq: number; traceId: string; text: string; episodeId?: string }> = [];
  for (const sessionId of sessions) {
    const rows = db.getStore()
      .prepare('SELECT trace_id, turn_seq FROM t1_turns WHERE session_id = ? ORDER BY turn_seq LIMIT ?')
      .all(sessionId, TURNS_PER_SESSION) as Array<{ trace_id: string; turn_seq: number }>;
    for (const row of rows) {
      const trace = db.readTrace(row.trace_id);
      const text = normalizeObservationText(trace?.rows ?? []);
      if (!text.trim()) continue;
      const member = db.getStore()
        .prepare('SELECT episode_id FROM t1_episode_members WHERE trace_id = ?')
        .get(row.trace_id) as { episode_id?: string } | undefined;
      turns.push({
        sessionId,
        turnSeq: row.turn_seq,
        traceId: row.trace_id,
        text,
        episodeId: member?.episode_id,
      });
    }
  }

  const anchors = buildConceptAnchors();
  const anchorVectors = await rt.provider.embed(anchors.map((a) => a.text), 'document');
  const vectors = await rt.provider.embed(turns.map((t) => t.text), 'document');
  const baselines = computeAnchorBaselines(anchorVectors, vectors);

  const codes = turns.map((_, i) => {
    const raw = anchors.map((anchor, j) => ({
      termId: anchor.termId,
      cosine: cosineSimilarity(vectors[i], anchorVectors[j]),
    }));
    const concept = new Set(selectCalibratedAtoms(raw, baselines).map((a) => a.termId));
    const direct = kwta(vectors[i], TOP_K);
    const expanded = kwta(expand(vectors[i]), TOP_K);
    return { concept, direct, expanded };
  });

  const adjacentIdx: Array<[number, number]> = [];
  const randomIdx: Array<[number, number]> = [];
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].sessionId === turns[i - 1].sessionId && turns[i].turnSeq - turns[i - 1].turnSeq === 1) {
      adjacentIdx.push([i - 1, i]);
    }
  }
  for (let i = 0; i < 2000; i++) {
    const a = Math.floor(Math.random() * turns.length);
    const b = Math.floor(Math.random() * turns.length);
    if (a === b || turns[a].sessionId === turns[b].sessionId) continue;
    randomIdx.push([a, b]);
  }

  const score = (key: 'concept' | 'direct' | 'expanded', pairs: Array<[number, number]>) =>
    pairs.map(([a, b]) => jaccard(codes[a][key] as any, codes[b][key] as any));

  const result = (key: 'concept' | 'direct' | 'expanded') => {
    const adjacent = score(key, adjacentIdx);
    const random = score(key, randomIdx);
    return {
      adjacentMean: +mean(adjacent).toFixed(3),
      adjacentMedian: +median(adjacent).toFixed(3),
      randomMean: +mean(random).toFixed(3),
      randomMedian: +median(random).toFixed(3),
      separation: +(random.length ? mean(adjacent) / (mean(random) || 1) : 0).toFixed(2),
      adjacentVsRandomAuc: +auc(adjacent, random).toFixed(3),
    };
  };

  const auc = (pos: number[], neg: number[]): number => {
    if (!pos.length || !neg.length) return 0.5;
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    return wins / (pos.length * neg.length);
  };

  // Top-1 neighbour same-episode rate (dense cosine as the reference).
  const sameEpisodeTop1 = (distance: (a: number, b: number) => number) => {
    let hits = 0;
    let total = 0;
    for (let i = 0; i < turns.length; i++) {
      let best = -1;
      let bestScore = -1;
      for (let j = 0; j < turns.length; j++) {
        if (i === j) continue;
        const s = distance(i, j);
        if (s > bestScore) {
          bestScore = s;
          best = j;
        }
      }
      if (!turns[i].episodeId || !turns[best]?.episodeId) continue;
      total++;
      if (turns[i].episodeId === turns[best].episodeId) hits++;
    }
    return total ? { hits, total, rate: +(hits / total).toFixed(3) } : null;
  };

  const sameEpisodePairs: Array<[number, number]> = [];
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[i].episodeId && turns[i].episodeId === turns[j].episodeId) {
        sameEpisodePairs.push([i, j]);
      }
    }
  }
  const episodeAuc = (key: 'concept' | 'direct' | 'expanded') =>
    +auc(
      score(key, sameEpisodePairs),
      score(key, randomIdx),
    ).toFixed(3);

  console.log(JSON.stringify({
    sessions: sessions.length,
    turns: turns.length,
    adjacentPairs: adjacentIdx.length,
    randomPairs: randomIdx.length,
    sameEpisodePairs: sameEpisodePairs.length,
    code: {
      concept: { ...result('concept'), sameEpisodeVsRandomAuc: episodeAuc('concept') },
      directKwta: { ...result('direct'), sameEpisodeVsRandomAuc: episodeAuc('direct') },
      expandedKwta: { ...result('expanded'), sameEpisodeVsRandomAuc: episodeAuc('expanded') },
      denseCosine: {
        sameEpisodeVsRandomAuc: +auc(
          sameEpisodePairs.map(([a, b]) => cosineSimilarity(vectors[a], vectors[b])),
          randomIdx.map(([a, b]) => cosineSimilarity(vectors[a], vectors[b])),
        ).toFixed(3),
      },
    },
    top1SameEpisode: {
      concept: sameEpisodeTop1((a, b) => jaccard(codes[a].concept as any, codes[b].concept as any)),
      denseCosine: sameEpisodeTop1((a, b) => cosineSimilarity(vectors[a], vectors[b])),
      expandedKwta: sameEpisodeTop1((a, b) => jaccard(codes[a].expanded as any, codes[b].expanded as any)),
    },
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
