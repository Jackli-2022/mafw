import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionStore } from '../src/store/connection.ts'

function harness() {
  const timers: { fn: () => void; ms: number }[] = []
  const states: string[] = []
  const received: { e: string; data: any }[] = []
  let connected = false
  let subscribes = 0
  let listeners = new Map<string, (d: any) => void>()
  const store = new ConnectionStore({
    sessionID: 'ses_1',
    subscribe: async (sid) => {
      subscribes++
      assert.equal(sid, 'ses_1')
      listeners = new Map()
      return {
        on: (e: string, cb: (d: any) => void) => {
          listeners.set(e, cb)
          return () => { listeners.delete(e) }
        },
      }
    },
    isConnected: () => connected,
    onEvent: (e, data) => received.push({ e, data }),
    onState: (s) => states.push(s),
    schedule: (fn, ms) => { timers.push({ fn, ms }) },
  })
  return {
    store,
    timers,
    states,
    received,
    emit: (type: string, data: any) => listeners.get(type)?.(data),
    setConnected: (v: boolean) => { connected = v },
    get subscribes() { return subscribes },
  }
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('start subscribes once and reports ok when connected', async () => {
  const h = harness()
  h.store.start()
  await settle()
  h.setConnected(true)
  h.timers.shift()!.fn() // 第一次 1s 健康检查 tick
  assert.equal(h.subscribes, 1)
  assert.ok(h.states.includes('ok'))
  h.store.stop()
})

test('disconnect triggers reconnecting + backoff resubscribe ladder', async () => {
  const h = harness()
  h.store.start()
  await settle()
  h.setConnected(true); h.timers.shift()!.fn()
  h.setConnected(false); h.timers.shift()!.fn() // 检测到断开
  assert.ok(h.states.includes('reconnecting'))
  const delays = h.timers.map(t => t.ms)
  assert.ok(delays.includes(1000), '第一次重连延迟 1000ms')
  // 连续断开循环：resub → health tick（仍断开）→ 下一档退避
  h.timers.findLast(t => t.ms === 1000)!.fn() // resub
  await settle()
  h.setConnected(false); h.timers.findLast(t => t.ms === 1000)!.fn() // health tick
  assert.ok(h.timers.some(t => t.ms === 2000), '第二次退避 2000ms')
  h.timers.findLast(t => t.ms === 2000)!.fn() // resub
  await settle()
  h.setConnected(false); h.timers.findLast(t => t.ms === 1000)!.fn() // health tick
  assert.ok(h.timers.some(t => t.ms === 5000), '第三次退避 5000ms')
  h.store.stop()
})

test('backoff caps at 15000ms', async () => {
  const h = harness()
  h.store.start()
  await settle()
  h.setConnected(false)
  for (let i = 0; i < 12 && h.timers.length; i++) {
    const t = h.timers.shift()!
    t.fn()
    await settle()
  }
  const maxDelay = Math.max(...h.timers.map(t => t.ms))
  assert.ok(maxDelay <= 15000, `封顶 15000，实际 ${maxDelay}`)
  h.store.stop()
})

test('events forwarded via onEvent; stop unsubscribes', async () => {
  const h = harness()
  h.store.start()
  await settle()
  h.emit('message.part.updated', { foo: 1 })
  assert.equal(h.received.length, 1)
  assert.equal(h.received[0].e, 'message.part.updated')
  h.store.stop()
  h.emit('session.idle', {})
  assert.equal(h.received.length, 1, 'stop 后不再转发')
})

test('subscribe rejection reports down state', async () => {
  const states: string[] = []
  const store = new ConnectionStore({
    sessionID: 's',
    subscribe: async () => { throw new Error('gateway down') },
    isConnected: () => false,
    onEvent: () => {},
    onState: (s) => states.push(s),
    schedule: () => {},
  })
  store.start()
  await settle()
  assert.ok(states.includes('down'))
  store.stop()
})

test('setSession re-subscribes to the new session and keeps forwarding events', async () => {
  let current = 'ses_1'
  let listeners = new Map<string, (d: any) => void>()
  const subscribedIds: string[] = []
  const received: { e: string; data: any }[] = []
  const store = new ConnectionStore({
    sessionID: 'ses_1',
    subscribe: async (sid) => {
      subscribedIds.push(sid)
      assert.equal(sid, current, '订阅目标与 setSession 一致')
      listeners = new Map()
      return {
        on: (e: string, cb: (d: any) => void) => {
          listeners.set(e, cb)
          return () => { listeners.delete(e) }
        },
      }
    },
    isConnected: () => true,
    onEvent: (e, data) => received.push({ e, data }),
    onState: () => {},
    schedule: () => {},
  })
  store.start()
  await settle()
  current = 'ses_2'
  store.setSession('ses_2')
  await settle()
  assert.deepEqual(subscribedIds, ['ses_1', 'ses_2'])
  listeners.get('message.part.updated')?.({ part: { sessionID: 'ses_2' } })
  assert.equal(received.length, 1, '新会话事件继续转发')
  store.stop()
})
