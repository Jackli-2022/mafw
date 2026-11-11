import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');

test('result view loads review items and gates acceptance on unresolved items', () => {
  const src = read('components/PodResultView.tsx');
  assert.match(src, /pod\.reviewItems\(/);
  assert.match(src, /reviewRefreshKey/);
  assert.match(src, /PodReviewItems/);
  assert.match(src, /reviewAcceptAction/);
  assert.match(src, /forcedAcceptReady/);
  assert.match(src, /riskAcknowledged/);
  assert.match(src, /force: true/);
  assert.match(src, /先处理意见/);
  assert.match(src, /确认风险并强制验收/);
  assert.match(src, /isReviewGateConflict/);
  assert.match(src, /revision: worktreeRevision\(\) \?\? undefined/);
});

test('goal detail forwards forced acceptance flags and rethrows only the review gate 409', () => {
  const src = read('components/GoalDetailPanel.tsx');
  assert.match(src, /acceptGoal = async \(opts\?: \{ revision\?: number; force\?: boolean; riskAcknowledged\?: boolean \}\)/);
  assert.match(src, /confirm: true, \.\.\.opts/);
  assert.match(src, /status === 409 && isReviewGateConflict\(err\)\) throw err/);
  assert.match(src, /reviewRefreshKey=\{\(\) => podStore\.reviewRevision\(\)\}/);
});
