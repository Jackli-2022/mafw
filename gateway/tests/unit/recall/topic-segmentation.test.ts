import { segmentTurns, deriveStructuralBreaks } from '../../../src/recall/topic-segmentation';

describe('V2 ② Tier0 structural breaks (deriveStructuralBreaks)', () => {
  const obs = (source: string, content: string) => ({ source, content });

  it('tool failure in a turn forces a break', () => {
    const turns = [
      [obs('user_input', 'continue work in src/core/a.ts')],
      [obs('tool_result', 'Error: ENOENT src/core/a.ts — command failed with exit code 1')],
    ];
    expect(deriveStructuralBreaks(turns as any)).toEqual([false, true]);
  });

  it('directory switch between turns forces a break; same directory does not', () => {
    const turns = [
      [obs('user_input', 'edit gateway/src/memory/store.ts please')],
      [obs('user_input', 'now fix gateway/src/memory/index.ts too')],      // same dir
      [obs('user_input', 'switch to packages/desktop/src/main.ts next')],  // new dir
    ];
    expect(deriveStructuralBreaks(turns as any)).toEqual([false, false, true]);
  });

  it('turns without paths or failures never break', () => {
    const turns = [
      [obs('assistant_reply', 'sounds good')],
      [obs('assistant_reply', 'agreed')],
    ];
    expect(deriveStructuralBreaks(turns as any)).toEqual([false, false]);
  });
});

describe('V2 ② TCM topic segmentation', () => {
  it('topic drift creates a boundary; same topic stays one segment', () => {
    const turns = [
      { text: 'fix the BM25 token cache bug in harmonic index' },
      { text: 'the BM25 cache now memoizes tokens per entry' },
      { text: 'the BM25 cache speeds up boundary recall' },
      { text: 'switching gears: the desktop tray icon needs a new menu' },
      { text: 'tray menu should show pending approvals count' },
    ];
    const segs = segmentTurns(turns);
    expect(segs).toHaveLength(2);
    expect(segs[0].items).toHaveLength(3);
    expect(segs[1].items).toHaveLength(2);
    expect(segs[1].boundaryBefore).toBe(true);
  });

  it('structuralBreak forces a boundary regardless of cosine', () => {
    const turns = [
      { text: 'bm25 cache work continues here' },
      { text: 'bm25 cache work continues more', structuralBreak: true },
    ];
    const segs = segmentTurns(turns);
    expect(segs).toHaveLength(2);
    expect(segs[1].boundaryBefore).toBe(true);
  });

  it('sealed segment vector is present (segment key = splitter)', () => {
    const turns = [
      { text: 'alpha beta gamma topic' },
      { text: 'completely different subject matter here' },
    ];
    const segs = segmentTurns(turns);
    for (const s of segs) expect(s.sealedVector).toBeDefined();
  });

  it('CJK content segments too', () => {
    const turns = [
      { text: '修复了 BM25 缓存 的 bug' },
      { text: 'BM25 缓存 现在按条目记忆' },
      { text: '切换话题：桌面托盘图标需要新菜单' },
      { text: '托盘菜单应显示待审批数量' },
    ];
    const segs = segmentTurns(turns);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });
});
