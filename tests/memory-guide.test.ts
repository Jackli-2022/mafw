import { buildMemoryGuide } from '../src/hooks/memory-guide';

const rules = [
  '主题管理（proactive）',
  '主题：未设置',
  'mafw_topic_set',
  '相关记忆：无',
  '主题偏移',
  '子代理不得调用 mafw_topic_set',
];

describe('OpenCode fallback memory guide', () => {
  test('carries the same proactive topic rules as the canonical guide', () => {
    const guide = buildMemoryGuide();
    for (const rule of rules) expect(guide).toContain(rule);
  });

  test('does not advertise tools that do not exist', () => {
    const guide = buildMemoryGuide();
    expect(guide).not.toContain('mafw_retract_memory');
    expect(guide).not.toContain('mafw_clarify_memory');
  });
});
