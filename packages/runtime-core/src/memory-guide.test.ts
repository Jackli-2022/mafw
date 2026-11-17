import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_GUIDE } from './host-adapter.ts';

const rules = [
  '主题管理（proactive）',
  '主题：未设置',
  'mafw_topic_set',
  '相关记忆：无',
  '主题偏移',
  '子代理不得调用 mafw_topic_set',
];

test('canonical memory guide teaches proactive topic management', () => {
  for (const rule of rules) assert.ok(MEMORY_GUIDE.includes(rule), `missing: ${rule}`);
});

test('canonical memory guide does not advertise missing tools', () => {
  assert.ok(!MEMORY_GUIDE.includes('mafw_retract_memory'));
  assert.ok(!MEMORY_GUIDE.includes('mafw_clarify_memory'));
});
