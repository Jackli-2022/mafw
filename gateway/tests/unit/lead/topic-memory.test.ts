import type { LeadTopicRow } from '../../../src/core/lead/lead-topic-store';
import { buildTopicMemory } from '../../../src/core/lead/topic-memory';

const NOW = '2026-11-10T00:00:00.000Z';

const topic = (over: Partial<LeadTopicRow> = {}): LeadTopicRow => ({
  id: 't1',
  projectDir: '/p',
  leadSessionId: 's1',
  title: 'SQLite 迁移',
  startMessageId: 'm1',
  endMessageId: 'm3',
  goalId: 'g1',
  ownerRole: 'tech-lead',
  ownerSessionId: null,
  createdAt: NOW,
  summary: '决定：A',
  summaryHash: 'hash',
  summaryUpdatedAt: NOW,
  state: 'warm',
  lastActiveAt: NOW,
  residentTokens: 10,
  resumedFrom: null,
  ...over,
});

test('builds a semantic memory with stable anchors', () => {
  const memory = buildTopicMemory({
    topic: topic(),
    summary: '决定：A',
    goalId: 'g1',
    projectDir: '/p',
  });
  expect(memory.memoryType).toBe('semantic');
  expect(memory.content).toContain('决定：A');
  expect(memory.content).toContain('SQLite 迁移');
  expect(memory.cueAnchors).toEqual(expect.arrayContaining(['t1', 'g1', '/p']));
});

test('promotes decisions and open loops only, never transcript sections', () => {
  const summary = [
    '决定：使用 WAL',
    'Open loops:',
    '- 迁移脚本还没写',
    'User words:',
    '- 用户原话不要进记忆',
    'Tool output:',
    '- npm test 输出',
  ].join('\n');

  const memory = buildTopicMemory({
    topic: topic(),
    summary,
    goalId: 'g1',
    projectDir: '/p',
  });

  expect(memory.content).toContain('决定：使用 WAL');
  expect(memory.content).toContain('迁移脚本还没写');
  expect(memory.content).not.toContain('用户原话不要进记忆');
  expect(memory.content).not.toContain('npm test 输出');
  expect(memory.content).not.toContain('User words:');
  expect(memory.content).not.toContain('Tool output:');
});

test('never falls back to transcript-only summaries', () => {
  const memory = buildTopicMemory({
    topic: topic(),
    summary: 'User words:\n- 只有用户原话\nTool output:\n- 只有工具输出',
    goalId: 'g1',
    projectDir: '/p',
  });
  expect(memory.content).not.toContain('只有用户原话');
  expect(memory.content).not.toContain('只有工具输出');
});
