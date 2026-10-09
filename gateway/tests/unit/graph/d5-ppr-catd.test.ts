// D5 delta over the existing bounded PPR: Hebbian need-modulated transitions
// (frequently-co-retrieved traces are easier to walk again) + Macro-Hub
// suppression (hubs are pathways, not destinations). CATD: decay half-life
// scales with topological load (EngramRAG arXiv:2609.32049).
import { personalizedPageRank } from '../../../src/graph/diffusion';
import { catdDecayRate } from '../../../src/core/memory/abstraction-level';
import { runEnergyDecay } from '../../../src/automation-engine';

describe('D5: Hebbian need modulation in PPR', () => {
  // seed A links to B (rarely retrieved) and C (frequently retrieved), equal weight
  const neighborsOf = (id: string): Map<string, number> => {
    if (id === 'A') return new Map([['B', 1], ['C', 1]]);
    return new Map();
  };

  it('need-modulated transitions favor the frequently retrieved target', () => {
    const flat = personalizedPageRank(['A'], neighborsOf, { alpha: 0.85, iterations: 15, candidateCap: 50 });
    const modulated = personalizedPageRank(['A'], neighborsOf, {
      alpha: 0.85, iterations: 15, candidateCap: 50,
      needFor: (id) => (id === 'C' ? 20 : 0),
    });
    expect(flat.get('B')).toBeCloseTo(flat.get('C') ?? -1, 5);
    expect(modulated.get('C')!).toBeGreaterThan(modulated.get('B')!);
  });

  it('no needFor → identical to legacy behavior', () => {
    const a = personalizedPageRank(['A'], neighborsOf, { alpha: 0.85, iterations: 15, candidateCap: 50 });
    const b = personalizedPageRank(['A'], neighborsOf, { alpha: 0.85, iterations: 15, candidateCap: 50, needFor: () => 0 });
    expect(b.get('B')).toBeCloseTo(a.get('B') ?? -1, 8);
  });
});

describe('D5: Macro-Hub suppression', () => {
  it('high-degree targets receive less mass than their raw edge weight implies', () => {
    // Hub H is linked from seed S and 100 other nodes; L is a leaf off S only.
    const hubLinks: [string, number][] = [['L', 1], ['H', 1]];
    const neighborsOf = (id: string): Map<string, number> => {
      if (id === 'S') return new Map(hubLinks);
      if (id === 'H') return new Map(Array.from({ length: 100 }, (_, i) => [`n${i}`, 1] as [string, number]));
      return new Map();
    };
    const plain = personalizedPageRank(['S'], neighborsOf, { alpha: 0.85, iterations: 15, candidateCap: 120 });
    const suppressed = personalizedPageRank(['S'], neighborsOf, {
      alpha: 0.85, iterations: 15, candidateCap: 120, hubFloor: 10,
    });
    // S→H and S→L start equal; suppression must tilt mass toward the leaf
    expect(suppressed.get('L')! / suppressed.get('H')!).toBeGreaterThan(plain.get('L')! / plain.get('H')!);
  });
});

describe('D5 CATD: topology-weighted decay', () => {
  it('hub entries decay slower, isolated entries unchanged', () => {
    const base = 0.005;
    expect(catdDecayRate(base, 0)).toBeCloseTo(base, 10);
    expect(catdDecayRate(base, 50)).toBeLessThan(base);
    expect(catdDecayRate(base, 500)).toBeLessThan(catdDecayRate(base, 50));
  });
  it('monotonic in degree and bounded below zero', () => {
    let prev = Infinity;
    for (const d of [0, 1, 5, 20, 100, 1000]) {
      const r = catdDecayRate(0.005, d);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });
  it('beta=0 disables modulation', () => {
    expect(catdDecayRate(0.005, 999, 0)).toBeCloseTo(0.005, 10);
  });
});

describe('D5 CATD: runEnergyDecay integration', () => {
  function fakeManager(entries: any[]) {
    const energy = new Map(entries.map((e) => [e.id, e.energy]));
    return {
      getIndex: () => ({ version: 2, entries, updated_at: 'x' }),
      getAnchorGraphStore: () => undefined,
      updateEnergy: (id: string, delta: number) => energy.set(id, (energy.get(id) ?? 0) + delta),
      stampDecay: () => {},
      save: () => {},
      migrateDecayBaseline: () => 0,
      _energy: energy,
    } as any;
  }
  const twoDaysAgo = new Date(Date.now() - 2 * 86400e3).toISOString();

  it('a load-bearing entry retains more energy than an isolated twin', () => {
    const entries = [
      { id: 'hub', type: 'semantic', energy: 0.8, salience: 1, created_at: twoDaysAgo, last_decay_at: twoDaysAgo },
      { id: 'leaf', type: 'semantic', energy: 0.8, salience: 1, created_at: twoDaysAgo, last_decay_at: twoDaysAgo },
    ];
    const mgr = fakeManager(entries);
    runEnergyDecay(mgr, Date.now(), [], { degreeFor: (id) => (id === 'hub' ? 200 : 0), beta: 0.5 });
    expect(mgr._energy.get('hub')).toBeGreaterThan(mgr._energy.get('leaf'));
  });

  it('without the catd provider, behavior is unchanged', () => {
    const entries = [{ id: 'a', type: 'semantic', energy: 0.8, salience: 1, created_at: twoDaysAgo, last_decay_at: twoDaysAgo }];
    const mgr = fakeManager(entries);
    const res = runEnergyDecay(mgr, Date.now(), []);
    expect(res.decayed).toBe(1);
  });
});
