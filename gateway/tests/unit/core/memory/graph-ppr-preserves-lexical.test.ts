// I1: the PPR pass must never convert an existing lexical candidate into a
// graph-only one. `byId` is seeded with the whole `scored` list, which can be
// longer than `candidateCap`; those beyond-cap entries are lexical hits, not
// graph-only nodes, so the graph pass may only add `graphScore` to them.
//
// The real PPR currently cannot emit a beyond-cap id (its node cap is filled by
// the seeds themselves), so the graph layer is stubbed here to report one — the
// invariant must hold for any candidate the association layer names.
jest.mock('../../../../src/graph/diffusion', () => ({
  personalizedPageRank: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../../../../src/config';
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';
import { personalizedPageRank } from '../../../../src/graph/diffusion';

const pprMock = personalizedPageRank as unknown as jest.Mock;

function unit(id: string, abstraction: string): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [],
    memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now,
  } as HarmonicUnit;
}

describe('graph expansion preserves beyond-cap lexical candidates', () => {
  it('keeps the lexical score of a candidate the graph layer reports', () => {
    const prevCap = config.search.graph.candidateCap;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-graph-beyond-cap-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    try {
      // 3 lexical hits, candidateCap 2 → only A/B become PPR seeds; C is a
      // lexical candidate outside the seed window.
      config.search.graph.candidateCap = 2;
      const index = new HarmonicIndexManager(dir);
      index.addEntry(unit('mem_a', 'sidecar sidecar sidecar alpha'), 'semantic');
      index.addEntry(unit('mem_b', 'sidecar sidecar beta'), 'semantic');
      index.addEntry(unit('mem_c', 'sidecar gamma'), 'semantic');
      // mem_d has no lexical evidence at all: the graph-only control.
      index.addEntry(unit('mem_d', 'incident postmortem unrelated'), 'semantic');
      index.setCoactivationGraphStore({
        getNeighbors: (ids: string[]) => {
          const out = new Map<string, Map<string, number>>();
          for (const id of ids) out.set(id, new Map([['mem_c', 1], ['mem_d', 1]]));
          return out;
        },
      } as any);
      pprMock.mockReturnValue(new Map([['mem_c', 1], ['mem_d', 1]]));

      const scored = index.searchScored('sidecar', 10, { retriever: 'bm25', graphExpand: true });
      const scoreOf = (id: string) => scored.find(s => s.entry.id === id)?.score;
      const cScore = scoreOf('mem_c');
      const dScore = scoreOf('mem_d');
      const graphWeight = config.search.graph.rerankGraphWeight;

      expect(cScore).toBeDefined();
      expect(dScore).toBeDefined();
      // The graph-only control tops out at the graph channel's weight.
      expect(dScore!).toBeCloseTo(graphWeight, 6);
      // The beyond-cap lexical candidate must keep its BM25 contribution on top
      // of the graph one (pre-fix: overwritten to the same 0.15 band as mem_d).
      expect(cScore!).toBeGreaterThan(dScore!);
      expect(cScore!).toBeGreaterThan(graphWeight);
    } finally {
      config.search.graph.candidateCap = prevCap;
      pprMock.mockReset();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
