import { selectAxiomSources, parseAxiomCandidates } from '../../../src/memory/axiom-distill';

const entry = (id: string, ageDays: number, type = 'semantic') => ({
  id, type, energy: 0.8, salience: 1,
  created_at: new Date(Date.now() - ageDays * 86400_000).toISOString(),
} as any);

describe('selectAxiomSources', () => {
  test('filters by type/liveness/age/need, ranks need*energy, caps', () => {
    const entries = [
      entry('ok1', 20), entry('young', 3), entry('epi', 30, 'episodic'),
      { ...entry('dead', 20), superseded_by: 'x' },
      ...Array.from({ length: 25 }, (_, i) => entry(`s${i}`, 30)),
    ];
    const needFor = (id: string) => (id === 'young' || id === 'epi' || id === 'dead' ? 99 : 1);
    const out = selectAxiomSources(entries, needFor, { now: Date.now(), minAgeDays: 14, cap: 20 });
    expect(out.map((e: any) => e.id)).not.toContain('young');
    expect(out.map((e: any) => e.id)).not.toContain('epi');
    expect(out.map((e: any) => e.id)).not.toContain('dead');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out[0].id).toBeDefined();
  });

  test('drops entries with zero need', () => {
    const out = selectAxiomSources([entry('n0', 30)], () => 0, { now: Date.now(), minAgeDays: 14, cap: 20 });
    expect(out).toEqual([]);
  });
});

describe('parseAxiomCandidates', () => {
  test('parses lines, caps at max, drops long/empty', () => {
    const reply = '公理一：任何后台管线必须 heartbeat\n' + 'y'.repeat(300) + '\n公理二：fail-open 是默认立场\n第四条\n第五条';
    const out = parseAxiomCandidates(reply, 3);
    expect(out.length).toBe(3);
    expect(out[0]).toContain('heartbeat');
  });
});
