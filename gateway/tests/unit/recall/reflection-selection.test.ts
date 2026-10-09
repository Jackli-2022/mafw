import { selectionFeedbackBlock } from '../../../src/recall/reflection';

describe('selectionFeedbackBlock (A4)', () => {
  it('renders used vs unused distilled insights for next-round calibration', () => {
    const block = selectionFeedbackBlock([
      { text: '被反复使用的洞察', need: 5 },
      { text: '从未被使用的洞察', need: 0 },
    ]);
    expect(block).toContain('被反复使用的洞察');
    expect(block).toContain('命中 5');
    expect(block).toContain('从未被使用的洞察');
    expect(block).toContain('未被检索');
    expect(block).toContain('合并或删除');
  });

  it('empty items → empty string', () => {
    expect(selectionFeedbackBlock([])).toBe('');
  });
});
