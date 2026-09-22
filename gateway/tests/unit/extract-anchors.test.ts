/**
 * Cue-anchor auto-fill (extractAnchors). CJK anchors must be multi-character
 * terms: single CJK chars fan out to every memory sharing the character and
 * destroy multi-hop precision (2026-09 index had 19% of entries polluted).
 */
import { extractAnchors } from '../../src/memory/derived-terms';

const isSingleCJK = (s: string) => /^[\u4e00-\u9fff]$/.test(s);

describe('extractAnchors (cue anchor auto-fill)', () => {
  test('Chinese abstraction yields CJK bigrams, never single chars', () => {
    const a = extractAnchors('冲突检测不能用NLI模型，需LLM四分类裁判');
    expect(a.length).toBeGreaterThan(0);
    expect(a.every(x => x.length >= 2)).toBe(true);
    expect(a).toContain('冲突');
    expect(a).toContain('检测');
    expect(a.some(isSingleCJK)).toBe(false);
  });

  test('mixed ASCII + Chinese keeps the ASCII entity and adds bigrams', () => {
    const a = extractAnchors('flylink 探针后台运行监控与结果落盘流程');
    expect(a).toContain('flylink');
    expect(a).toContain('探针');
    expect(a.every(x => x.length >= 2)).toBe(true);
  });

  test('bigrams containing CJK function characters are skipped', () => {
    const a = extractAnchors('这个和那个的结果');
    expect(a).toContain('结果');
    for (const bg of a) {
      expect(bg).not.toMatch(/[的个和这那了是在与及或]/);
    }
  });

  test('caps at 5 anchors', () => {
    const a = extractAnchors('冲突检测置信度双阈值宁可共存不强行合并记忆系统架构设计实现验证');
    expect(a.length).toBeLessThanOrEqual(5);
  });

  test('empty input → []', () => {
    expect(extractAnchors('')).toEqual([]);
  });
});
