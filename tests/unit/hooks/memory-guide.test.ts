import { buildMemoryGuide, memoryGuideHook } from '../../../src/hooks/memory-guide';

describe('memoryGuideHook (OptMem-style active memory guidance)', () => {
  test('injects the guide into system on every call (persistent)', () => {
    const output: any = { system: ['existing'] };
    memoryGuideHook({}, output);
    expect(output.system.length).toBe(2);
    expect(output.system[0]).toBe('existing');
    expect(output.system[1]).toContain('<memory-guide>');
    expect(output.system[1]).toContain('</memory-guide>');

    // Second call injects again — persistent per-turn guidance.
    const output2: any = { system: [] };
    memoryGuideHook({}, output2);
    memoryGuideHook({}, output2);
    expect(output2.system.length).toBe(2);
  });

  test('creates the system array when absent', () => {
    const output: any = {};
    memoryGuideHook({}, output);
    expect(Array.isArray(output.system)).toBe(true);
    expect(output.system[0]).toContain('## 记忆');
  });

  test('guide mentions the mandatory write tools', () => {
    const guide = buildMemoryGuide();
    expect(guide).toContain('mafw_add_memory');
    expect(guide).toContain('mafw_search_hybrid');
    expect(guide).toContain('主动写入');
    expect(guide).toContain('主动检索');
  });

  test('guide tells subagents to skip memory tools', () => {
    const guide = buildMemoryGuide();
    expect(guide).toContain('子代理');
    expect(guide).toContain('不得调用 mafw_add_memory / mafw_search_hybrid');
  });

  test('guide carries no mafw- prefixed tags', () => {
    expect(buildMemoryGuide()).not.toContain('mafw-');
  });
});
