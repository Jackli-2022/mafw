import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionStore } from '../src/store/connection.ts'

/**
 * E1-8：连接状态必须**边沿触发**。
 *
 * 修复前 `healthTick()` 每 1s 都调 `onState('ok')`，而 app.ts 的 onState('ok')
 * 会 invalidate + 重新 load Experience 与 gateway queue —— 连接稳定时每秒重载。
 * 契约：状态变更才回调；健康 tick 的心跳调度保持不变。
 */
function harness() {
  const timers: { fn: () => void; ms: number }[] = []
  const states: string[] = []
  let connected = false
  let subscribes = 0
  const store = new ConnectionStore({
    sessionID: 'global',
    subscribe: async () => {
      subscribes++
      return { on: () => () => {} }
    },
    isConnected: () => connected,
    onEvent: () => {},
    onState: (s) => states.push(s),
    schedule: (fn, ms) => { timers.push({ fn, ms }) },
  })
  return {
    store,
    timers,
    states,
    setConnected: (v: boolean) => { connected = v },
    get subscribes() { return subscribes },
    /** 取下一个 1s 健康 tick 并执行（不自动推进时间）。 */
    nextHealthTick: () => {
      const idx = timers.findIndex((t) => t.ms === 1000)
      assert.ok(idx >= 0, 'expected a pending 1000ms health tick')
      const [tick] = timers.splice(idx, 1)
      tick.fn()
    },
    healthTicksPending: () => timers.filter((t) => t.ms === 1000).length,
  }
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('connected: 连续 5 次健康 tick 只回调一次 ok（边沿触发）', async () => {
  const h = harness()
  h.store.start()
  await settle()
  h.setConnected(true)

  for (let i = 0; i < 5; i++) h.nextHealthTick()

  assert.deepEqual(h.states, ['ok'], '稳定连接不得每秒重复上报 ok')
  assert.equal(h.healthTicksPending(), 1, '心跳本身继续调度')
  h.store.stop()
})

test('ok → reconnecting → ok：每次状态变更各回调一次', async () => {
  const h = harness()
  h.store.start()
  await settle()
  h.setConnected(true)
  h.nextHealthTick() // ok

  h.setConnected(false)
  h.nextHealthTick() // reconnecting（并调度 backoff resubscribe）
  const resub = h.timers.splice(h.timers.findIndex((t) => t.ms === 1000), 1)[0]
  assert.ok(resub, '断开后应有 1000ms 的 resubscribe 定时器')
  resub.fn()
  await settle()

  h.setConnected(true)
  h.nextHealthTick() // ok again（状态变化 → 再回调一次）
  h.nextHealthTick() // 稳定后不再回调

  assert.deepEqual(h.states, ['ok', 'reconnecting', 'ok'])
  h.store.stop()
})

test('持续断开：重复 reconnecting tick 不重复回调', async () => {
  const states: string[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const store = new ConnectionStore({
    sessionID: 'global',
    subscribe: async () => ({ on: () => () => {} }),
    isConnected: () => false,
    onEvent: () => {},
    onState: (s) => states.push(s),
    schedule: (fn, ms) => { timers.push({ fn, ms }) },
  })
  store.start()
  await settle()

  // 依次执行 health tick 与 backoff resubscribe（两者首次都是 1000ms，按队列推进）。
  for (let i = 0; i < 6 && timers.length; i++) {
    timers.shift()!.fn()
    await settle()
  }
  assert.equal(states.filter((s) => s === 'reconnecting').length, 1, '持续断开只上报一次')
  store.stop()
})
