import { reconstructSource } from '../../src/recall/source-reconstruction';

const t = (source: string, content: string) => ({ source, content } as any);

describe('reconstructSource', () => {
  test('角色标签 + 换行合并', () => {
    const out = reconstructSource([
      t('user_input', 'hello\nworld'),
      t('assistant_reply', 'answer'),
      t('tool_result', 'out'),
      t('reasoning', 'think'),
    ], 1000);
    expect(out).toContain('[USER] hello world');
    expect(out).toContain('[ASSISTANT] answer');
    expect(out).toContain('[TOOL] out');
    expect(out).toContain('[THINKING] think');
  });

  test('预算截断', () => {
    const out = reconstructSource([t('user_input', 'a'.repeat(100)), t('assistant_reply', 'b'.repeat(100))], 60);
    expect(out.length).toBeLessThanOrEqual(60);
  });

  test('空输入空串', () => {
    expect(reconstructSource([], 1000)).toBe('');
  });

  test('首条超长仍产出截断证据（非空）', () => {
    const out = reconstructSource([t('tool_result', 'x'.repeat(5000))], 200);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.startsWith('[TOOL]')).toBe(true);
  });
});
