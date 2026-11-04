// packages/desktop/src/main/attention-diff.test.ts
import assert from 'node:assert/strict'
import { diffAttention } from './attention-diff'

assert.deepEqual(diffAttention(['a'], [{ id: 'a' }, { id: 'b' }]).added, [{ id: 'b' }])
assert.deepEqual(diffAttention(['a', 'b'], [{ id: 'b' }]).removed, ['a'])
assert.deepEqual(diffAttention([], [{ id: 'x' }]).added, [{ id: 'x' }])
assert.deepEqual(diffAttention(['x'], []).removed, ['x'])
// revision 变更算新 id：打回后第二版计划批准必须重新通知
assert.deepEqual(
  diffAttention(['g1:plan_approval:r1'], [{ id: 'g1:plan_approval:r2' }]).added,
  [{ id: 'g1:plan_approval:r2' }],
)
