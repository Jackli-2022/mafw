/**
 * R6 presentation layer: bundle the chronological neighbours of top hits into
 * the injected <recall> block. Neighbours never compete for ranking — they are
 * extra context (CueMem/EdgeMem style), so the effect is only measurable at L2.
 */
import { formatRecallContext, NEIGHBOR_BUDGET } from '../../../src/recall/inject-format';

const mem = (id: string, text: string, date = '2024-05-01T00:00:00Z') => ({
  id, primary_abstraction: text, memory_value: text, energy: 0.8, type: 'episodic', created_at: date,
});

describe('formatRecallContext R6 neighbours', () => {
  test('back-compat: no neighbours map → identical output', () => {
    const m = [mem('mem_1_aaaaaa', 'anchor fact')];
    expect(formatRecallContext(m).pointers).toBe(formatRecallContext(m, {}).pointers);
  });

  test('renders neighbour lines under their anchor', () => {
    const m = [mem('mem_1_aaaaaa', 'anchor fact'), mem('mem_1_bbbbbb', 'other hit')];
    const neighbors = new Map([[m[0].id, [mem('mem_1_cccccc', 'adjacent episode', '2024-04-30T00:00:00Z')]]]);
    const { pointers } = formatRecallContext(m, { neighbors });
    expect(pointers).toContain('anchor fact');
    expect(pointers).toContain('adjacent episode');
    expect(pointers).toContain('↳');
    // the neighbour line sits after its anchor line
    expect(pointers!.indexOf('anchor fact')).toBeLessThan(pointers!.indexOf('adjacent episode'));
  });

  test('caps neighbour lines (budget) while keeping the anchors', () => {
    const m = [mem('mem_1_aaaaaa', 'anchor fact')];
    const many = Array.from({ length: 10 }, (_, i) => mem(`mem_1_nb${String(i).padStart(4, '0')}`, `neighbor ${i}`));
    const { pointers } = formatRecallContext(m, { neighbors: new Map([[m[0].id, many]]) });
    const rendered = (pointers!.match(/↳/g) || []).length;
    expect(rendered).toBeLessThanOrEqual(NEIGHBOR_BUDGET.maxLines);
    expect(pointers).toContain('anchor fact');
  });

  test('neighbour bundling states the recency preference (knowledge-update)', () => {
    const m = [mem('mem_1_aaaaaa', 'anchor fact')];
    const { pointers } = formatRecallContext(m, {
      neighbors: new Map([[m[0].id, [mem('mem_1_cccccc', 'older version')]]]),
    });
    expect(pointers).toContain('最近');
  });

  test('no neighbours rendered → no recency note', () => {
    const m = [mem('mem_1_aaaaaa', 'anchor fact')];
    expect(formatRecallContext(m).pointers).not.toContain('最近');
    expect(formatRecallContext(m, { neighbors: new Map() }).pointers).not.toContain('最近');
  });
});
