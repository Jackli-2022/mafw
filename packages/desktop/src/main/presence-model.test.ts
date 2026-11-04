// packages/desktop/src/main/presence-model.test.ts
import assert from 'node:assert/strict'
import { podPresence } from './presence-model'

assert.equal(podPresence(null).trayState, 'idle')
assert.equal(podPresence(null).progress, -1)

const running: any = {
  running: [{
    podId: 'p1', projectId: 'a', projectName: 'mafw', goalId: 'g1', title: '冒烟',
    phase: 'EXECUTING', node: 'execute', progress: { current: 2, total: 3 },
    startedAt: 't', updatedAt: 't',
  }],
  attention: { count: 0, items: [] },
  unreadResults: { count: 0, latest: null },
}

const p = podPresence(running)
assert.equal(p.trayState, 'running')
assert.equal(p.progress, 2 / 3)
assert.match(p.tooltip, /冒烟 · execute 2\/3/)
assert.deepEqual(p.clickTarget, { podId: 'p1', goalId: 'g1' })

assert.equal(podPresence({ ...running, attention: { count: 1, items: [{ id: 'x' }] } }).trayState, 'attention')
assert.equal(podPresence({ ...running, running: [], unreadResults: { count: 1, latest: running.running[0] } }).trayState, 'attention')

const noProgress = podPresence({ ...running, running: [{ ...running.running[0], progress: null }] })
assert.equal(noProgress.progress, 2) // indeterminate

const twoGoals = podPresence({
  ...running,
  running: [running.running[0], { ...running.running[0], podId: 'p2', goalId: 'g2', title: '标签' }],
})
assert.match(twoGoals.tooltip, /2 个 Goal 在跑/)
