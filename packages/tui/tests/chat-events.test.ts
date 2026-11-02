import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatStore } from '../src/store/chat-store.ts'
import { CHAT_EVENT_TYPES, dispatchChatEvent, isChatEvent } from '../src/ui/chat-events.ts'

function fakeSession() {
  return {
    async messages() { return { data: [], nextCursor: null } },
    async promptAsync() {},
    async abort() {},
    async revert() {},
    async unrevert() {},
  }
}

function makeStore() {
  return new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
}

function textPart(text: string) {
  return { id: 'pa', messageID: 'ma', sessionID: 's', type: 'text', text }
}

test('dispatchChatEvent: part.updated 立即更新 transcript（live 流式）', () => {
  const store = makeStore()
  assert.equal(dispatchChatEvent(store, 'part.updated', { type: 'part.updated', properties: { part: textPart('Hel') } }), true)
  assert.equal(store.turns.length, 1, '无历史也能创建 assistant turn')
  assert.equal(store.turns[0].role, 'assistant')
  assert.equal(store.turns[0].parts[0].text, 'Hel')
  dispatchChatEvent(store, 'part.updated', { type: 'part.updated', properties: { part: textPart('Hello') } })
  assert.equal(store.turns[0].parts.length, 1, '同 partID 快照替换')
  assert.equal(store.turns[0].parts[0].text, 'Hello')
})

test('dispatchChatEvent: part.updated 工具状态 running → completed 更新工具卡', () => {
  const store = makeStore()
  const tool = (status: string, output?: string) => ({
    id: 'pt', messageID: 'ma', sessionID: 's', type: 'tool', callID: 'c1', tool: 'bash',
    state: { status, input: { command: 'npm test' }, ...(output ? { output } : {}) },
  })
  dispatchChatEvent(store, 'part.updated', { type: 'part.updated', properties: { part: tool('running') } })
  assert.equal(store.turns[0].parts[0].state, 'running')
  assert.equal(store.turns[0].parts[0].text, 'npm test', 'running 不带输出')
  dispatchChatEvent(store, 'part.updated', { type: 'part.updated', properties: { part: tool('completed', 'ok 12 passed') } })
  assert.equal(store.turns[0].parts[0].state, 'completed')
  assert.ok(store.turns[0].parts[0].text.includes('ok 12 passed'))
})

test('dispatchChatEvent: turn.failed 终结回合（streaming 清空 + done）', async () => {
  const store = makeStore()
  await store.send('q')
  dispatchChatEvent(store, 'part.updated', { type: 'part.updated', properties: { part: textPart('半截') } })
  assert.equal(store.streaming, true)
  assert.equal(dispatchChatEvent(store, 'turn.failed', { type: 'turn.failed', sessionID: 's' }), true)
  assert.equal(store.streaming, false)
  assert.equal(store.turns.at(-1)!.done, true, '失败也结束当前 assistant turn')
})

test('dispatchChatEvent: turn.aborted 终结回合；他会话终态被忽略', async () => {
  const store = makeStore()
  await store.send('q')
  dispatchChatEvent(store, 'turn.aborted', { type: 'turn.aborted', sessionID: 'other' })
  assert.equal(store.streaming, true, '他会话终态不影响')
  dispatchChatEvent(store, 'turn.aborted', { type: 'turn.aborted', sessionID: 's' })
  assert.equal(store.streaming, false)
  assert.equal(store.turns.at(-1)!.done, true)
})

test('dispatchChatEvent: 非 chat 事件不触碰 store', () => {
  const store = makeStore()
  for (const type of ['permission.asked', 'background.job.updated', 'runtime_switched', 'queue.updated']) {
    assert.equal(dispatchChatEvent(store, type, { type }), false)
  }
  assert.equal(store.turns.length, 0)
  assert.equal(store.streaming, false)
})

test('dispatchChatEvent: part.delta 累积成 assistant turn（无 message_start 也能建 turn）', () => {
  const store = makeStore()
  const delta = (delta: string, field = 'text', partID = 'pia_1_t1', messageID = 'pia_1') =>
    ({ type: 'part.delta', sessionID: 's', properties: { sessionID: 's', messageID, partID, field, delta } })
  assert.equal(dispatchChatEvent(store, 'part.delta', delta('Hel')), true)
  assert.equal(store.turns.length, 1, 'delta 自带身份 → 按 messageID 建 assistant turn')
  assert.equal(store.turns[0].messageID, 'pia_1')
  assert.equal(store.turns[0].role, 'assistant')
  assert.equal(store.turns[0].done, false)
  assert.equal(store.turns[0].parts[0].text, 'Hel')
  dispatchChatEvent(store, 'part.delta', delta('lo'))
  assert.equal(store.turns[0].parts.length, 1, '同一 partID 累积到同一 part')
  assert.equal(store.turns[0].parts[0].text, 'Hello')
  // reasoning 另一条流：type 是身份的一部分
  dispatchChatEvent(store, 'part.delta', delta('hmm', 'reasoning', 'pia_1_r2'))
  assert.deepEqual(store.turns[0].parts.map((p) => [p.id, p.type, p.text]), [
    ['pia_1_t1', 'text', 'Hello'],
    ['pia_1_r2', 'reasoning', 'hmm'],
  ])
})

test('dispatchChatEvent: part.delta 忽略畸形/他会话/空增量', () => {
  const store = makeStore()
  const base = { type: 'part.delta', sessionID: 's', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'x' } }
  assert.equal(dispatchChatEvent(store, 'part.delta', { ...base, properties: { ...base.properties, delta: '' } }), true)
  dispatchChatEvent(store, 'part.delta', { ...base, sessionID: 'other', properties: { ...base.properties, sessionID: 'other' } })
  dispatchChatEvent(store, 'part.delta', { ...base, properties: { ...base.properties, field: 'tool' } })
  dispatchChatEvent(store, 'part.delta', { ...base, properties: { ...base.properties, partID: undefined } })
  assert.equal(store.turns.length, 0, '没有任何无效增量建成 turn')
})

test('CHAT_EVENT_TYPES 覆盖 chat 白名单（part/turn 三元组）', () => {
  assert.deepEqual([...CHAT_EVENT_TYPES], ['part.updated', 'part.delta', 'turn.completed', 'turn.failed', 'turn.aborted'])
  assert.equal(isChatEvent('part.updated'), true)
  assert.equal(isChatEvent('part.delta'), true)
  assert.equal(isChatEvent('turn.failed'), true)
  assert.equal(isChatEvent('session.config'), false)
})
