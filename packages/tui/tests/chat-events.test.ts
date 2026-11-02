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

test('CHAT_EVENT_TYPES 覆盖 chat 白名单（part/turn 三元组）', () => {
  assert.deepEqual([...CHAT_EVENT_TYPES], ['part.updated', 'turn.completed', 'turn.failed', 'turn.aborted'])
  assert.equal(isChatEvent('part.updated'), true)
  assert.equal(isChatEvent('turn.failed'), true)
  assert.equal(isChatEvent('session.config'), false)
})
