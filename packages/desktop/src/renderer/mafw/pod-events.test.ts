// packages/desktop/src/renderer/mafw/pod-events.test.ts
import assert from 'node:assert/strict'
import { isResultViewed, listUnread, shouldMarkSeen } from './pod-events'

const ev = (over: any = {}) => ({
  id: 'e', goalId: 'g1', revision: 1, kind: 'goal.result', severity: 'p1' as const,
  title: '', summary: null, state: 'seen' as const, createdAt: '1', ...over,
})

assert.equal(isResultViewed('g1:r1', [ev()], []), true)
assert.equal(isResultViewed('g1:r2', [ev()], []), false)
// legacy localStorage 仍生效（存量未查看结果不能在升级后消失）
assert.equal(isResultViewed('g1:r2', [], ['g1:r2']), true)
assert.equal(isResultViewed('g1:r2', [], []), false)

const items = [
  ev({ id: 'a', severity: 'p3', state: 'unread', createdAt: '2' }),
  ev({ id: 'b', severity: 'p1', state: 'unread', createdAt: '1' }),
]
assert.deepEqual(listUnread(items).map((i) => i.id), ['b', 'a'])

// 结果接口失败时绝不能标 seen
assert.equal(shouldMarkSeen({ status: 'fulfilled' }), true)
assert.equal(shouldMarkSeen({ status: 'rejected' }), false)
assert.equal(shouldMarkSeen({ status: 'pending' }), false)
