// Graph expansion must not give graph-only candidates a lexical channel.
// Regression for 2026-11-18: PPR/hop-greedy nodes were stored with
// `score: gs` (their *graph* score), so `nbv = norm(score)` handed them the
// BM25 channel they never earned and they could reach 1.0, outranking every
// literal hit on the shared live index (REST hit@1 55% → 3%).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../../../../src/config';
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';

const GRAPH_ONLY = 'mem_graph_only';
const TOP_SEED = 'mem_top';

function unit(id: string, abstraction: string, energy = 0.8): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [],
    memory_value: abstraction, energy, created_at: now, updated_at: now,
  } as HarmonicUnit;
}

function seedGraph(index: HarmonicIndexManager): void {
  index.setCoactivationGraphStore({
    getNeighbors: (ids: string[]) => {
      const out = new Map<string, Map<string, number>>();
      for (const id of ids) if (id !== GRAPH_ONLY) out.set(id, new Map([[GRAPH_ONLY, 1]]));
      return out;
    },
  } as any);
}

/**
 * Flat-score corpus: 30 BM25 seeds share the query token (common token → small
 * idf, the live corpus shape), so the double-counted graph score used to win.
 * Also holds one entry with no query token at all.
 */
function buildFlat(dir: string): HarmonicIndexManager {
  const index = new HarmonicIndexManager(dir);
  for (let i = 0; i < 30; i++) {
    index.addEntry(unit(i === 0 ? TOP_SEED : `mem_seed_${i}`, i === 0
      ? 'sidecar sidecar sidecar health'
      : `sidecar probe notes ${i}`), 'semantic');
  }
  index.addEntry(unit(GRAPH_ONLY, 'incident postmortem unrelated content'), 'semantic');
  seedGraph(index);
  return index;
}

/**
 * Tail-completion corpus: one strong lexical hit, one weak lexical hit
 * (energy 0.1 → its normalized lexical score stays below the graph weight),
 * and one graph-only neighbour. 3 candidates, so a topK of 2 is a real cut.
 */
function buildTail(dir: string): HarmonicIndexManager {
  const index = new HarmonicIndexManager(dir);
  index.addEntry(unit(TOP_SEED, 'sidecar sidecar sidecar health'), 'semantic');
  index.addEntry(unit('mem_weak', 'sidecar notes', 0.1), 'semantic');
  index.addEntry(unit(GRAPH_ONLY, 'incident postmortem unrelated content'), 'semantic');
  seedGraph(index);
  return index;
}

/** Run under a diffusion toggle; always restores config and removes the temp dir. */
function withIndex<T>(
  usePpr: boolean,
  seed: (dir: string) => HarmonicIndexManager,
  fn: (index: HarmonicIndexManager) => T,
): T {
  const prev = config.search.graph.diffusion.enabled;
  let dir: string | undefined;
  try {
    config.search.graph.diffusion.enabled = usePpr;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-graph-channels-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    return fn(seed(dir));
  } finally {
    config.search.graph.diffusion.enabled = prev;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.each([
  ['PPR diffusion', true],
  ['legacy hop-greedy', false],
])('graph expansion channel separation (%s)', (_label, usePpr) => {
  it('never lets the graph-only neighbour outrank the strongest lexical seed', () => {
    const ids = withIndex(usePpr, buildFlat, (index) =>
      index.searchScored('sidecar', 5, { retriever: 'bm25', graphExpand: true }).map(s => s.entry.id));
    expect(ids[0]).toBe(TOP_SEED);
  });

  it('returns the graph-only neighbour as tail completion (topK cuts a weak lexical hit)', () => {
    // 3 candidates, topK 2: the graph-only node must earn the second slot.
    const ids = withIndex(usePpr, buildTail, (index) =>
      index.searchScored('sidecar', 2, { retriever: 'bm25', graphExpand: true }).map(s => s.entry.id));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(TOP_SEED);
    expect(ids).toContain(GRAPH_ONLY);
  });
});
