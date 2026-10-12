import { gracePrioritySort } from '../../../src/recall/reflection';

const NOW = Date.parse('2026-10-12T00:00:00.000Z');
const H = 3600 * 1000;

function hit(id: string, type: string, hoursAgo: number) {
  return { entry: { id, type, created_at: new Date(NOW - hoursAgo * H).toISOString() } };
}

describe('V2 ⑤ gracePrioritySort (evidence ordering)', () => {
  it('grace-window semantic/procedural entries surface first, order otherwise stable', () => {
    const hits = [
      hit('old-episodic', 'episodic', 100),
      hit('old-semantic', 'semantic', 200),
      hit('young-semantic', 'semantic', 10),
      hit('young-episodic', 'episodic', 5),
      hit('young-procedural', 'procedural', 20),
    ];
    const out = gracePrioritySort(hits, NOW);
    expect(out.map(h => h.entry.id)).toEqual([
      'young-semantic', 'young-procedural', // grace window first (stable within)
      'old-episodic', 'old-semantic', 'young-episodic', // rest in original order
    ]);
  });

  it('exactly-48h-old entry still counts (window is inclusive)', () => {
    const hits = [hit('edge', 'semantic', 48), hit('out', 'semantic', 49)];
    const out = gracePrioritySort(hits, NOW);
    expect(out.map(h => h.entry.id)).toEqual(['edge', 'out']);
  });
});
