import { renderMemoryBlocks } from '../../../gateway/src/recall/inject-format';

describe('renderMemoryBlocks', () => {
  test('buckets parametric deltas into <deltas>', () => {
    const blocks = renderMemoryBlocks([
      { source: 'parametric', type: 'delta', content: 'must pass tests' },
      { source: 'parametric', type: 'constraint', content: 'no SaaS' },
    ]);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toContain('<deltas>');
    expect(blocks[0]).toContain('[Δ delta] must pass tests');
    expect(blocks[0]).toContain('[Δ constraint] no SaaS');
    expect(blocks[0]).not.toContain('mafw-');
  });

  test('buckets patterns into <patterns> with success rate', () => {
    const blocks = renderMemoryBlocks([
      { source: 'procedural', type: 'pattern', pattern: 'run tests first', successRate: 0.75 },
    ]);
    expect(blocks[0]).toContain('<patterns>');
    expect(blocks[0]).toContain('[75%] run tests first');
  });

  test('buckets semantic facts into <facts>', () => {
    const blocks = renderMemoryBlocks([
      { source: 'semantic', type: 'fact', facts: ['JWT uses RS256', 'coverage 80%'] },
    ]);
    expect(blocks[0]).toContain('<facts>');
    expect(blocks[0]).toContain('☑ JWT uses RS256; coverage 80%');
  });

  test('buckets episodic/history entries into <history>', () => {
    const blocks = renderMemoryBlocks([
      { source: 'episodic', type: 'history', summary: 'review failed', verdict: 'FAIL', loopNum: 2 },
    ]);
    expect(blocks[0]).toContain('<history>');
    expect(blocks[0]).toContain('Loop 2: FAIL ☑ review failed');
  });

  test('type-based mapping without source (verdict implies history)', () => {
    const blocks = renderMemoryBlocks([
      { type: 'constraint', content: 'self-hosted' },
      { type: 'pattern', content: 'retry once' },
      { verdict: 'PASS', content: 'all green' },
      { type: 'other', content: 'plain fact' },
    ]);
    const joined = blocks.join('\n');
    expect(joined).toContain('<deltas>');
    expect(joined).toContain('<patterns>');
    expect(joined).toContain('<history>');
    expect(joined).toContain('<facts>');
  });

  test('omits empty buckets', () => {
    const blocks = renderMemoryBlocks([]);
    expect(blocks).toEqual([]);
  });

  test('skips entries whose rendered line is blank', () => {
    const blocks = renderMemoryBlocks([{ source: 'semantic', type: 'fact', content: '' }]);
    expect(blocks).toEqual([]);
  });

  test('blocks never carry a mafw- prefix', () => {
    const blocks = renderMemoryBlocks([
      { source: 'parametric', type: 'delta', content: 'a' },
      { source: 'procedural', type: 'pattern', pattern: 'b', successRate: 1 },
      { source: 'semantic', type: 'fact', content: 'c' },
      { source: 'episodic', type: 'history', summary: 'd' },
    ]);
    for (const block of blocks) expect(block).not.toContain('mafw-');
  });
});
