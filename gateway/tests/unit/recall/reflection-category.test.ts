import { buildInsightUnit, ORPHAN_SESSION } from '../../../src/recall/reflection';

describe('buildInsightUnit', () => {
  it('persists category as cat: anchor (L2 failure-taxonomy surface)', () => {
    const u = buildInsightUnit(
      { category: 'failure', content: 'serve 崩溃后事件订阅必须重连', cue_anchors: ['serve', 'watchdog'] },
      'ses_x',
      '2026-10-08T00:00:00.000Z',
    );
    expect(u.cue_anchors).toContain('cat:failure');
    expect(u.cue_anchors).toEqual(['serve', 'watchdog', 'cat:failure']);
    expect(u.type).toBe('semantic');
    expect(u.energy).toBe(0.9);
    expect(u.abstraction_level).toBe(2);
  });

  it('tolerates missing cue_anchors', () => {
    const u = buildInsightUnit({ category: 'insight', content: 'x' }, ORPHAN_SESSION, '2026-10-08T00:00:00.000Z');
    expect(u.cue_anchors).toEqual(['cat:insight']);
    expect(u.source_session_id).toBeUndefined();
  });
});
