import { formatRecallContext, renderMemoryBlocks } from '../../../gateway/src/recall/inject-format';

describe('formatRecallContext', () => {
  it('returns null for empty memories', () => {
    expect(formatRecallContext([]).pointers).toBeNull();
  });

  it('renders basic pointer with energy', () => {
    const result = formatRecallContext([{
      id: 'mem_1234567890_abc',
      primary_abstraction: 'test memory',
      memory_value: 'fallback value',
      energy: 0.75,
    }]);
    expect(result.pointers).toContain('#mem-mem_1');
    expect(result.pointers).toContain('"test memory"');
    expect(result.pointers).toContain('(E:0.8)');
  });

  it('includes date and type tags when present', () => {
    const result = formatRecallContext([{
      id: 'mem_2',
      primary_abstraction: 'fact',
      energy: 0.9,
      type: 'semantic',
      created_at: '2026-08-18T14:30:00.000Z',
    }]);
    expect(result.pointers).toContain('[2026-08-18 semantic]');
  });

  it('escapes multiline text to a single line', () => {
    const result = formatRecallContext([{
      id: 'mem_3',
      primary_abstraction: 'line one\nline two',
      energy: 0.5,
    }]);
    expect(result.pointers).not.toContain('\nline two');
    expect(result.pointers).toContain('line one line two');
  });

  it('caps at top 3 memories', () => {
    const memories = Array.from({ length: 5 }, (_, i) => ({
      id: `mem_${i}`,
      primary_abstraction: `memory ${i}`,
      energy: 0.8,
    }));
    const lines = formatRecallContext(memories).pointers?.split('\n') || [];
    const pointerLines = lines.filter(l => l.startsWith('- #mem-'));
    expect(pointerLines).toHaveLength(3);
  });
});

describe('renderMemoryBlocks', () => {
  it('renders facts bucket by default', () => {
    const blocks = renderMemoryBlocks([{ content: 'I live in Beijing', type: 'semantic' }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('<facts>');
    expect(blocks[0]).toContain('☑ I live in Beijing');
  });
});
