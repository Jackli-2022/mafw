import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatStore } from '../src/store/chat-store.ts'

// wire 形态（对齐 desktop loadOlder / gateway index.ts:4196）：
//   { data: [{ info: { id, role, time }, parts: [...] }], nextCursor }
function historyItem(id: string, role: 'user' | 'assistant', parts: any[]) {
  return { info: { id, role, time: { created: 1 } }, parts }
}

function fakeSession(over: Record<string, any> = {}) {
  const calls: Record<string, any> = { promptAsync: [], abort: 0, messages: [] }
  return {
    calls,
    async messages(p: any) {
      calls.messages.push(p)
      return {
        data: [
          historyItem('m1', 'user', [{ id: 'p1', messageID: 'm1', type: 'text', text: '你好' }]),
          historyItem('m2', 'assistant', [{ id: 'p2', messageID: 'm2', type: 'text', text: '你好！有什么可以帮你？' }]),
        ],
        nextCursor: 'cursor-1',
      }
    },
    async promptAsync(p: any) { calls.promptAsync.push(p) },
    async abort() { calls.abort++ },
    ...over,
  }
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('loadHistory maps {info,parts} items to turns with roles', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory()
  assert.equal(s.turns.length, 2)
  assert.equal(s.turns[0].role, 'user')
  assert.equal(s.turns[1].role, 'assistant')
  assert.equal(s.turns[0].parts[0].text, '你好')
  assert.ok(s.turns.every(t => t.done))
})

test('send appends user turn and calls promptAsync with parts', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('hello world')
  assert.equal(fx.calls.promptAsync.length, 1)
  assert.deepEqual(fx.calls.promptAsync[0].body.parts, [{ type: 'text', text: 'hello world' }])
  assert.equal(fx.calls.promptAsync[0].path.id, 's')
  assert.equal(s.turns.at(-1)!.role, 'user')
  assert.equal(s.streaming, true)
})

test('message.part.updated snapshot-replaces per partID; session.idle finalizes', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('message.part.updated', { type: 'message.part.updated', properties: { part: { id: 'pa', messageID: 'ma', sessionID: 's', type: 'text', text: 'Hel' } } })
  s.applyEvent('message.part.updated', { type: 'message.part.updated', properties: { part: { id: 'pa', messageID: 'ma', sessionID: 's', type: 'text', text: 'Hello' } } })
  assert.equal(s.streaming, true)
  const t = s.turns.at(-1)!
  assert.equal(t.role, 'assistant')
  assert.equal(t.parts.length, 1, '同 partID 快照替换不新增')
  assert.equal(t.parts[0].text, 'Hello')
  s.applyEvent('session.idle', { type: 'session.idle' })
  assert.equal(s.streaming, false)
  assert.equal(s.turns.at(-1)!.done, true)
})

test('ignores parts from other sessions', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('message.part.updated', { type: 'message.part.updated', properties: { part: { id: 'px', messageID: 'mx', sessionID: 'other', type: 'text', text: 'x' } } })
  assert.equal(s.turns.length, 1, '只有本地 user turn')
})

test('tool part running until terminal status; output only when completed', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('message.part.updated', { type: 'message.part.updated', properties: { part: { id: 'pt', messageID: 'ma', sessionID: 's', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'npm test' } } } } })
  let part = s.turns.at(-1)!.parts[0]
  assert.equal(part.state, 'running')
  assert.ok(part.text.includes('npm test'))
  assert.equal(part.text, 'npm test', 'running 不含输出')
  s.applyEvent('message.part.updated', { type: 'message.part.updated', properties: { part: { id: 'pt', messageID: 'ma', sessionID: 's', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' }, output: 'ok 12 passed' } } } })
  part = s.turns.at(-1)!.parts[0]
  assert.equal(part.state, 'completed')
  assert.ok(part.text.includes('ok 12 passed'))
})

test('abort calls session.abort and clears streaming', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  await s.abort()
  assert.equal(fx.calls.abort, 1)
  assert.equal(s.streaming, false)
})

test('send failure clears streaming and surfaces error', async () => {
  const fx = fakeSession({ async promptAsync() { throw new Error('network down') } })
  const errors: string[] = []
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {}, onError: (e) => errors.push(e) })
  await s.send('q')
  assert.equal(s.streaming, false)
  assert.equal(errors.length, 1)
  assert.ok(errors[0].includes('network down'))
})

test('loadOlder uses cursor and prepends; returns 0 when no cursor', async () => {
  let call = 0
  const fx = fakeSession({
    async messages({ query }: any) {
      call++
      if (query?.before === 'cursor-1') {
        return { data: [historyItem('m0', 'user', [{ id: 'p0', messageID: 'm0', type: 'text', text: '更早' }])], nextCursor: null }
      }
      return {
        data: [historyItem('m1', 'user', [{ id: 'p1', messageID: 'm1', type: 'text', text: '你好' }])],
        nextCursor: 'cursor-1',
      }
    },
  })
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory()
  const n = await s.loadOlder()
  assert.equal(n, 1)
  assert.equal(s.turns[0].parts[0].text, '更早')
  assert.equal(await s.loadOlder(), 0)
})

test('loadHistory failure reports error and keeps empty turns', async () => {
  const errors: string[] = []
  const s = new ChatStore({
    session: fakeSession({ async messages() { throw new Error('boom') } }) as any,
    sessionID: 's',
    onChange: () => {},
    onError: (e) => errors.push(e),
  })
  await s.loadHistory()
  assert.equal(s.turns.length, 0)
  assert.ok(errors[0].includes('boom'))
})

test('loadHistory filters injected blocks (recall/note-board/goal-snapshot)', async () => {
  const fx = fakeSession({
    async messages() {
      return {
        data: [
          historyItem('m1', 'assistant', [
            { id: 'p1', messageID: 'm1', type: 'text', text: '正常回复' },
            { id: 'p2', messageID: 'm1', type: 'text', text: '<recall>\n[联想线索]\n  - #mem-xxx [semantic] ...' },
            { id: 'p3', messageID: 'm1', type: 'text', text: '<note-board>\n[用户叮嘱 · 到期自动下架]' },
            { id: 'p4', messageID: 'm1', type: 'text', text: '<goal-snapshot>\n<goal id="g1">...' },
          ]),
        ],
        nextCursor: null,
      }
    },
  })
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory()
  assert.equal(s.turns.length, 1)
  assert.equal(s.turns[0].parts.length, 1, '注入块被过滤')
  assert.equal(s.turns[0].parts[0].text, '正常回复')
})

test('busy sends are queued (turn flagged queued) and flushed on idle in order', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('first')
  await s.send('second')
  await s.send('third')
  assert.equal(fx.calls.promptAsync.length, 1, 'streaming 期间不立即发送')
  const queuedTurns = s.turns.filter(t => t.queued)
  assert.equal(queuedTurns.length, 2, '两条排队 turn')
  assert.deepEqual(queuedTurns.map(t => t.parts[0].text), ['second', 'third'])
  s.applyEvent('session.idle', { type: 'session.idle' })
  await settle()
  assert.equal(fx.calls.promptAsync.length, 2, 'idle 后自动发一条')
  assert.deepEqual(fx.calls.promptAsync[1].body.parts, [{ type: 'text', text: 'second' }])
  assert.equal(s.turns.filter(t => t.queued).length, 1, '还剩一条排队')
  s.applyEvent('session.idle', { type: 'session.idle' })
  await settle()
  assert.equal(fx.calls.promptAsync.length, 3)
  assert.deepEqual(fx.calls.promptAsync[2].body.parts, [{ type: 'text', text: 'third' }])
  assert.equal(s.turns.filter(t => t.queued).length, 0)
})

test('message.complete (gateway 对 session.idle 的翻译名) finalizes turn and flushes queue', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  await s.send('queued-msg')
  s.applyEvent('message.part.updated', { type: 'message.part.updated', properties: { part: { id: 'pa', messageID: 'ma', sessionID: 's', type: 'text', text: 'Hi' } } })
  assert.equal(s.streaming, true)
  // Mode A 广播的回合结束事件：{ type: 'message.complete', sessionID }
  s.applyEvent('message.complete', { type: 'message.complete', sessionID: 's' })
  await settle()
  assert.equal(fx.calls.promptAsync.length, 2, 'message.complete 视同 idle → flush 排队')
  assert.equal(s.turns.filter(t => t.queued).length, 0, '排队转正')
  assert.equal(s.turns.filter(t => t.parts[0]?.text === 'queued-msg').length, 1)
})

test('message.complete from another session is ignored', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('message.complete', { type: 'message.complete', sessionID: 'other' })
  await settle()
  assert.equal(s.streaming, true, '他session的complete不影响')
  assert.equal(fx.calls.promptAsync.length, 1)
})

test('flushed queued turn is re-used (no duplicate user turn)', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('first')
  const before = s.turns.length
  await s.send('second')
  s.applyEvent('session.idle', { type: 'session.idle' })
  await settle()
  assert.equal(s.turns.length, before + 1, '排队 turn 转正而非新增')
  assert.equal(s.turns.at(-1)!.parts[0].text, 'second')
  assert.equal(s.turns.at(-1)!.queued, undefined)
})

test('send passes selected model to promptAsync when getModel is set', async () => {
  const fx = fakeSession()
  const s = new ChatStore({
    session: fx as any, sessionID: 's', onChange: () => {},
    getModel: () => ({ providerID: 'xiaomi', modelID: 'mimo-v2.5' }),
  })
  await s.send('q')
  assert.deepEqual(fx.calls.promptAsync[0].body.model, { providerID: 'xiaomi', modelID: 'mimo-v2.5' })
})

test('switchSession reloads history for the new session id', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's1', onChange: () => {} })
  await s.loadHistory()
  assert.equal(s.sessionID, 's1')
  await s.switchSession('s2')
  assert.equal(s.sessionID, 's2')
  assert.deepEqual(fx.calls.messages.at(-1).path, { id: 's2' })
})

test('undo reverts to last user message and reloads; redo calls unrevert', async () => {
  const calls: any[] = []
  const fx = fakeSession({
    async revert(p: any) { calls.push(['revert', p]) },
    async unrevert(_p: any) { calls.push(['unrevert']) },
  })
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory() // m1(user 你好) m2(assistant)
  await s.undo()
  assert.equal(calls[0][0], 'revert')
  assert.equal(calls[0][1].body.messageID, 'm1', 'revert 到最后一条 user 消息')
  assert.deepEqual(fx.calls.messages.at(-1).path, { id: 's' }, 'undo 后重载历史')
  await s.redo()
  assert.equal(calls[1][0], 'unrevert')
})

test('queue management: queuedCount / takeBackAll / dropQueuedAt', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('first')
  await s.send('q2')
  await s.send('q3')
  assert.equal(s.queuedCount, 2)
  // drop 中间一条
  assert.equal(s.dropQueuedAt(0), 'q2', '按排队顺序丢弃（0 = 最早）')
  assert.equal(s.queuedCount, 1)
  // takeBackAll 取回全部剩余
  assert.deepEqual(s.takeBackAll(), ['q3'])
  assert.equal(s.queuedCount, 0)
  assert.equal(s.turns.filter(t => t.queued).length, 0, 'turns 里的排队项一并移除')
  // 空队列
  assert.deepEqual(s.takeBackAll(), [])
  assert.equal(s.dropQueuedAt(0), null)
})
