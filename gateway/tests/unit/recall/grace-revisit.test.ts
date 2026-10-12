import { selectGraceCandidates, GraceRevisitPipeline, GraceVerdict, createGraceWriteOps, computeSalienceV2 } from '../../../src/recall/grace-revisit';
import { HarmonicIndexEntry } from '../../../src/core/memory/harmonic-types';

const T0 = Date.parse('2026-10-12T00:00:00.000Z');
const H = 3600 * 1000;
function mkEntry(id: string, hoursAgo: number, cues: string[], extra: any = {}): HarmonicIndexEntry {
  return { id, type: 'semantic', primary_abstraction: id, cue_anchors: cues, tier: 'semantic',
    energy: 0.6, created_at: new Date(T0 - hoursAgo * H).toISOString(), ...extra } as any;
}

describe('selectGraceCandidates (48h × PE gate, V2 ④)', () => {
  it('young gist with newer same-cue content → selected with its related set', () => {
    const young = mkEntry('g1', 10, ['bm25']);
    const newer = mkEntry('n1', 2, ['bm25']);
    const out = selectGraceCandidates([young, newer], T0);
    expect(out.map(o => o.id)).toEqual(['g1']);
    expect(out[0].related.map(r => r.id)).toEqual(['n1']);
  });

  it('young gist with NO newer related → not selected (no PE, no window)', () => {
    const young = mkEntry('g2', 10, ['docker']);
    const old = mkEntry('o1', 100, ['docker']);
    expect(selectGraceCandidates([young, old], T0)).toEqual([]);
  });

  it('older than 48h / superseded / rejected / redundant-anchored / episodic → excluded', () => {
    const a = mkEntry('a', 50, ['x']);                          // past window
    const b = mkEntry('b', 10, ['x'], { superseded_by: 'z' });   // superseded
    const c = mkEntry('c', 10, ['x'], { cue_anchors: ['x', 'rejected'] });
    const d = mkEntry('d', 10, ['x'], { cue_anchors: ['x', 'redundant:mem_1'] });
    const e = mkEntry('e', 10, ['x'], { type: 'episodic' });
    const newer = mkEntry('n2', 1, ['x']);
    expect(selectGraceCandidates([a, b, c, d, e, newer], T0)).toEqual([]);
  });

  it('caps at maxPerRun', () => {
    const entries: HarmonicIndexEntry[] = [];
    for (let i = 0; i < 8; i++) {
      entries.push(mkEntry(`g${i}`, 5, ['k']));
      entries.push(mkEntry(`n${i}`, 1, ['k']));
    }
    expect(selectGraceCandidates(entries, T0, { maxPerRun: 3 })).toHaveLength(3);
  });
});

describe('GraceRevisitPipeline verdict execution', () => {
  function mkDeps(verdicts: GraceVerdict[], mode: 'shadow' | 'live', entryOverrides: any = {}) {
    const entries: HarmonicIndexEntry[] = [
      { ...mkEntry('g1', 5, ['bm25']), ...entryOverrides },
      mkEntry('n1', 1, ['bm25']),
    ];
    const log: Array<GraceVerdict & { executed: boolean }> = [];
    const calls = { superseded: [] as string[], merged: [] as string[], rejected: [] as string[] };
    const deps = {
      index: { getIndex: () => ({ entries }) },
      readMemory: async (id: string) => ({ id, memory_value: `value of ${id}`, superseded_by: undefined } as any),
      worker: { prompt: async () => JSON.stringify({ revisits: verdicts }) },
      writeSuperseding: async (oldId: string, content: string) => {
        calls.superseded.push(`${oldId}:${content}`); return 'new-unit';
      },
      writeMerged: async (aId: string, bId: string, content: string) => {
        calls.merged.push(`${aId}+${bId}:${content}`); return 'merged-unit';
      },
      markRejected: async (id: string) => { calls.rejected.push(id); },
      mode,
      onVerdict: (v: any) => log.push(v),
    };
    return { deps, log, calls };
  }

  it('live mode executes update/merge/demote and logs every verdict', async () => {
    const { deps, log, calls } = mkDeps([
      { id: 'g1', verdict: 'update', content: 'merged new text' },
    ], 'live');
    const r = await new GraceRevisitPipeline(deps as any).runOnce();
    expect(r.updated).toBe(1);
    expect(calls.superseded).toEqual(['g1:merged new text']);
    expect(log).toEqual([{ id: 'g1', verdict: 'update', content: 'merged new text', executed: true }]);
  });

  it('shadow mode logs verdicts but never executes', async () => {
    const { deps, log, calls } = mkDeps([
      { id: 'g1', verdict: 'demote' },
    ], 'shadow');
    const r = await new GraceRevisitPipeline(deps as any).runOnce();
    expect(r.demoted).toBe(0);
    expect(r.skipped).toBe(1);
    expect(calls.rejected).toEqual([]);
    expect(log[0].executed).toBe(false);
  });

  it('authority=user entries are observe-only even in live mode (G1 discipline)', async () => {
    const { deps, log, calls } = mkDeps([
      { id: 'g1', verdict: 'update', content: 'x' },
    ], 'live', { authority: 'user' });
    const r = await new GraceRevisitPipeline(deps as any).runOnce();
    expect(r.updated).toBe(0);
    expect(calls.superseded).toEqual([]);
    expect(log[0].executed).toBe(false);
  });

  it('keep verdict counts kept; unknown verdict skipped', async () => {
    const { deps, log } = mkDeps([
      { id: 'g1', verdict: 'keep' },
    ], 'live');
    const r = await new GraceRevisitPipeline(deps as any).runOnce();
    expect(r.kept).toBe(1);
    expect(log).toEqual([{ id: 'g1', verdict: 'keep', executed: false }]);
  });
});

describe('V2 ⑥ computeSalienceV2 (observe-only)', () => {
  it('weighted composite with clamped static, normalized need, authority rank, novelty default', () => {
    const out = computeSalienceV2(
      { id: 's1', salience: 1.5, authority: 'user', novelty: 0.8 },
      { needFor: () => 10 }, // clamped to 1
    );
    expect(out.static).toBe(1);          // clamped
    expect(out.need).toBe(1);            // 10/5 clamped
    expect(out.authority).toBe(1);       // user = 3/3
    expect(out.novelty).toBe(0.8);
    expect(out.value).toBeCloseTo(0.5 * 1 + 0.25 * 1 + 0.15 * 1 + 0.1 * 0.8, 5);
  });

  it('legacy entry: absent salience/authority/novelty → neutral defaults', () => {
    const out = computeSalienceV2({ id: 's2' }, {});
    expect(out.static).toBe(0.5);
    expect(out.need).toBe(0);
    expect(out.authority).toBeCloseTo(1 / 3, 5); // pipeline
    expect(out.novelty).toBe(0.5);
    expect(out.value).toBeCloseTo(0.5 * 0.5 + 0.15 / 3 + 0.05, 5);
  });

  it('onSalience rides the selection pass (candidate + related each once)', async () => {
    const entries: HarmonicIndexEntry[] = [
      mkEntry('g9', 5, ['bm25']),
      mkEntry('n9', 1, ['bm25']),
    ];
    const seen: string[] = [];
    const deps = {
      index: { getIndex: () => ({ entries }) },
      readMemory: async (id: string) => ({ id, memory_value: 'v' } as any),
      worker: { prompt: async () => '{"revisits":[]}' },
      writeSuperseding: async () => 'x',
      writeMerged: async () => 'x',
      markRejected: async () => undefined,
      mode: 'shadow' as const,
      onVerdict: () => undefined,
      onSalience: (l: any) => seen.push(l.id),
      needFor: () => 0,
    };
    await new GraceRevisitPipeline(deps as any).runOnce();
    expect(seen.sort()).toEqual(['g9', 'n9']);
  });
});

describe('createGraceWriteOps (real store round-trip)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { HarmonicUnitFileStore } = require('../../../src/memory/harmonic-file-store');
  const { HarmonicIndexManager } = require('../../../src/core/memory/harmonic-index');

  let dir: string;
  let store: any;
  let idx: any;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwgr-'));
    idx = new HarmonicIndexManager(dir);
    store = new HarmonicUnitFileStore(dir, idx);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = '2026-10-12T00:00:00.000Z';
  async function seed(id: string, cues: string[]) {
    await store.write({ id, type: 'semantic', primary_abstraction: id, cue_anchors: cues,
      memory_value: `value ${id}`, energy: 0.6, created_at: now, updated_at: now } as any);
  }

  it('writeSuperseding: new version lands, old takes the chain', async () => {
    await seed('a1', ['bm25']);
    const ops = createGraceWriteOps(store);
    const newId = await ops.writeSuperseding('a1', 'updated full text');
    const entries = idx.getIndex().entries;
    expect(entries.find((e: any) => e.id === 'a1').superseded_by).toBe(newId);
    expect(entries.find((e: any) => e.id === newId).primary_abstraction).toBe('updated full text');
  });

  it('writeMerged: combined unit supersedes both, cue union, merged_from', async () => {
    await seed('m1', ['bm25', 'cache']);
    await seed('m2', ['bm25', 'speed']);
    const ops = createGraceWriteOps(store);
    const newId = await ops.writeMerged('m1', 'm2', 'combined text');
    const entries = idx.getIndex().entries;
    const merged = entries.find((e: any) => e.id === newId);
    expect(merged.merged_from).toEqual(['m1', 'm2']);
    expect(merged.cue_anchors).toEqual(['bm25', 'cache', 'speed']);
    expect(entries.find((e: any) => e.id === 'm1').superseded_by).toBe(newId);
    expect(entries.find((e: any) => e.id === 'm2').superseded_by).toBe(newId);
  });

  it('markRejected: energy 0.05 + rejected anchor', async () => {
    await seed('r1', ['x']);
    const ops = createGraceWriteOps(store);
    await ops.markRejected('r1');
    const u = await store.read('r1');
    expect(u.energy).toBe(0.05);
    expect(u.cue_anchors).toContain('rejected');
  });
});
