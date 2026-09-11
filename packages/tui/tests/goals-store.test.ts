import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GoalsStore } from '../src/store/goals-store.ts'

const G = (goalId: string, phase: string, loop = 0) => ({ goalId, phase, loop, currentWave: 0, totalWaves: 0 })

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('poll loads goals and questions; active goals sort first', async () => {
  const timers: (() => void)[] = []
  const store = new GoalsStore({
    goals: { list: async () => [G('g2', 'COMPLETED'), G('g1', 'EXECUTING')] } as any,
    questions: { list: async () => [{ id: 'q1', sessionID: 's', questions: [{ question: '继续吗？', options: [{ label: '是' }, { label: '否' }] }] }] } as any,
    onChange: () => {},
    schedule: (fn) => { timers.push(fn); return () => {} },
  })
  store.start()
  await settle()
  assert.equal(store.rows.length, 2)
  assert.equal(store.rows[0].goalId, 'g1', '活跃在前')
  assert.equal(store.questions.length, 1)
  store.stop()
})

test('poll failure keeps old data', async () => {
  let fail = false
  const store = new GoalsStore({
    goals: { list: async () => { if (fail) throw new Error('down'); return [G('g1', 'EXECUTING')] } } as any,
    questions: { list: async () => { if (fail) throw new Error('down'); return [] } } as any,
    onChange: () => {},
    schedule: () => () => {},
  })
  store.start()
  await settle()
  assert.equal(store.rows.length, 1)
  fail = true
  await store.poll()
  assert.equal(store.rows.length, 1, '失败保留旧数据')
  store.stop()
})

test('isActive helper treats COMPLETED/FAILED/ARCHIVED as terminal', () => {
  const store = new GoalsStore({
    goals: { list: async () => [] } as any,
    questions: { list: async () => [] } as any,
    onChange: () => {},
  })
  assert.equal(GoalsStore.isActive(G('a', 'EXECUTING')), true)
  assert.equal(GoalsStore.isActive(G('a', 'COMPLETED')), false)
  assert.equal(GoalsStore.isActive(G('a', 'FAILED')), false)
  assert.equal(GoalsStore.isActive(G('a', 'ARCHIVED')), false)
  store.stop()
})
