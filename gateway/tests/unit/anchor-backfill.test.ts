/**
 * Backfill planner for entries whose cue_anchors were auto-filled as single
 * CJK chars (pre-2026-09 extractAnchors). Drops the junk, keeps real anchors,
 * re-derives bigrams from the abstraction.
 */
import { planAnchorBackfill, rebuildAnchors } from '../../src/memory/anchor-backfill';

const isSingleCJK = (s: string) => /^[\u4e00-\u9fff]$/.test(s);

describe('anchor backfill', () => {
  test('all-junk anchors are replaced with bigrams', () => {
    const after = rebuildAnchors({ id: 'a', primary_abstraction: '冲突检测不能用NLI模型', cue_anchors: ['冲', '突', '检'] });
    expect(after.length).toBeGreaterThan(0);
    expect(after.some(isSingleCJK)).toBe(false);
    expect(after).toContain('冲突');
  });

  test('good anchors are preserved, junk dropped, bigrams fill the rest', () => {
    const after = rebuildAnchors({ id: 'b', primary_abstraction: 'flylink 探针后台运行', cue_anchors: ['flylink', '探', '针', '后'] });
    expect(after).toContain('flylink');
    expect(after.some(isSingleCJK)).toBe(false);
    expect(after).toContain('探针');
  });

  test('entries without single-CJK anchors are untouched', () => {
    const entry = { id: 'c', primary_abstraction: 'x', cue_anchors: ['react', 'component'] };
    expect(rebuildAnchors(entry)).toEqual(['react', 'component']);
    expect(planAnchorBackfill([entry])).toEqual([]);
  });

  test('plan reports before/after only for affected entries', () => {
    const plan = planAnchorBackfill([
      { id: 'ok', primary_abstraction: 'x', cue_anchors: ['react'] },
      { id: 'bad', primary_abstraction: '冲突检测', cue_anchors: ['冲', '突'] },
    ]);
    expect(plan.map(p => p.id)).toEqual(['bad']);
    expect(plan[0].before).toEqual(['冲', '突']);
    expect(plan[0].after.length).toBeGreaterThan(0);
  });

  test('respects the anchor cap', () => {
    const after = rebuildAnchors(
      { id: 'd', primary_abstraction: '冲突检测置信度双阈值宁可共存不强行合并记忆系统架构设计实现验证', cue_anchors: ['冲', '突'] },
      8,
    );
    expect(after.length).toBeLessThanOrEqual(8);
  });
});
