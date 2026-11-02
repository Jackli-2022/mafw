import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatStore } from '../src/store/chat-store.ts'

// Task 12：历史只读 flat MAFW View DTO（`content`），不再有 `{info,parts}` 双形状。
function flatMessage(id: string, role: 'user' | 'assistant', content: any[] = []) {
  return { id, sessionID: 's', role, time: { created: 1 }, content }
}

function textPart(id: string, messageID: string, text: string) {
  return { id, messageID, sessionID: 's', type: 'text', text }
}

function fakeSession(over: Record<string, any> = {}) {
  const calls: Record<string, any> = { promptAsync: [], abort: 0, messages: [] }
  return {
    calls,
    async messages(p: any) {
      calls.messages.push(p)
      return {
        data: [
          flatMessage('m1', 'user', [textPart('p1', 'm1', '你好')]),
          flatMessage('m2', 'assistant', [textPart('p2', 'm2', '你好！有什么可以帮你？')]),
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

test('loadHistory reads flat content only (no info/parts)', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory()
  assert.equal(s.turns.length, 2)
  assert.equal(s.turns[0].role, 'user')
  assert.equal(s.turns[1].role, 'assistant')
  assert.equal(s.turns[0].parts[0].text, '你好')
  assert.ok(s.turns.every(t => t.done))
})

test('uses session.messages (flat) with limit instead of a legacy history helper', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory(20)
  assert.deepEqual(fx.calls.messages[0], { path: { id: 's' }, query: { limit: 20 } })
})

test('tool part fallback uses canonical fields (canonicalTool ?? tool)', async () => {
  const fx = fakeSession({
    async messages() {
      return {
        data: [
          flatMessage('m1', 'assistant', [{
            id: 'pt', messageID: 'm1', type: 'tool', callID: 'c1',
            tool: 'command_execution', canonicalTool: 'bash',
            state: { status: 'completed', input: { command: 'npm test' }, output: 'ok' },
          }]),
        ],
        nextCursor: null,
      }
    },
  })
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.loadHistory()
  assert.equal(s.turns[0].parts[0].type, 'tool')
  assert.equal(s.turns[0].parts[0].tool, 'bash')
  assert.ok(s.turns[0].parts[0].text.includes('ok'))
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

test('part.updated snapshot-replaces per partID; turn.completed finalizes', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  const part = (text: string) => ({
    id: 'pa', messageID: 'ma', sessionID: 's', type: 'text', text,
  })
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: part('Hel') } })
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: part('Hello') } })
  assert.equal(s.streaming, true)
  const t = s.turns.at(-1)!
  assert.equal(t.role, 'assistant')
  assert.equal(t.parts.length, 1, '同 partID 快照替换不新增')
  assert.equal(t.parts[0].text, 'Hello')
  s.applyEvent('turn.completed', { type: 'turn.completed' })
  assert.equal(s.streaming, false)
  assert.equal(s.turns.at(-1)!.done, true)
})

test('ignores parts from other sessions', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: { id: 'px', messageID: 'mx', sessionID: 'other', type: 'text', text: 'x' } } })
  assert.equal(s.turns.length, 1, '只有本地 user turn')
})

test('tool part running until terminal status; output only when completed', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  const toolPart = (status: string, output?: string) => ({
    id: 'pt', messageID: 'ma', sessionID: 's', type: 'tool', callID: 'c1', tool: 'bash',
    state: { status, input: { command: 'npm test' }, ...(output ? { output } : {}) },
  })
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: toolPart('running') } })
  let part = s.turns.at(-1)!.parts[0]
  assert.equal(part.state, 'running')
  assert.ok(part.text.includes('npm test'))
  assert.equal(part.text, 'npm test', 'running 不含输出')
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: toolPart('completed', 'ok 12 passed') } })
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
  const fx = fakeSession({
    async messages({ query }: any) {
      if (query?.before === 'cursor-1') {
        return { data: [flatMessage('m0', 'user', [textPart('p0', 'm0', '更早')])], nextCursor: null }
      }
      return { data: [flatMessage('m1', 'user', [textPart('p1', 'm1', '你好')])], nextCursor: 'cursor-1' }
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
          flatMessage('m1', 'assistant', [
            textPart('p1', 'm1', '正常回复'),
            textPart('p2', 'm1', '<recall>\n[联想线索]\n  - #mem-xxx [semantic] ...'),
            textPart('p3', 'm1', '<note-board>\n[用户叮嘱 · 到期自动下架]'),
            textPart('p4', 'm1', '<goal-snapshot>\n<goal id="g1">...'),
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
  s.applyEvent('turn.completed', { type: 'turn.completed' })
  await settle()
  assert.equal(fx.calls.promptAsync.length, 2, 'turn.completed 后自动发一条')
  assert.deepEqual(fx.calls.promptAsync[1].body.parts, [{ type: 'text', text: 'second' }])
  assert.equal(s.turns.filter(t => t.queued).length, 1, '还剩一条排队')
  s.applyEvent('turn.completed', { type: 'turn.completed' })
  await settle()
  assert.equal(fx.calls.promptAsync.length, 3)
  assert.deepEqual(fx.calls.promptAsync[2].body.parts, [{ type: 'text', text: 'third' }])
  assert.equal(s.turns.filter(t => t.queued).length, 0)
})

test('busy steer: prompt.steer 支持时立即发 delivery=steer（不写本地队列）', async () => {
  const fx = fakeSession()
  const s = new ChatStore({
    session: fx as any, sessionID: 's', onChange: () => {},
    busyDelivery: () => 'steer',
  })
  await s.send('first')
  await s.send('插一句')
  assert.equal(fx.calls.promptAsync.length, 2, 'steer 立即投递')
  assert.equal(fx.calls.promptAsync[1].body.delivery, 'steer')
  assert.equal(s.queuedCount, 0, 'steer 不占本地队列')
  const steered = s.turns.filter(t => t.parts[0]?.text === '插一句')
  assert.equal(steered.length, 1)
  assert.equal(steered[0].queued, undefined)
})

test('busy fallback: 无 steer 时保持本地队列语义', async () => {
  const fx = fakeSession()
  const s = new ChatStore({
    session: fx as any, sessionID: 's', onChange: () => {},
    busyDelivery: () => 'queue',
  })
  await s.send('first')
  await s.send('later')
  assert.equal(fx.calls.promptAsync.length, 1)
  assert.equal(s.queuedCount, 1)
  assert.equal(fx.calls.promptAsync[0].body.delivery, undefined)
})

test('turn.completed (v2 回合终态) finalizes turn and flushes queue', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  await s.send('queued-msg')
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: { id: 'pa', messageID: 'ma', sessionID: 's', type: 'text', text: 'Hi' } } })
  assert.equal(s.streaming, true)
  s.applyEvent('turn.completed', { type: 'turn.completed', sessionID: 's' })
  await settle()
  assert.equal(fx.calls.promptAsync.length, 2, 'turn.completed → flush 排队')
  assert.equal(s.turns.filter(t => t.queued).length, 0, '排队转正')
  assert.equal(s.turns.filter(t => t.parts[0]?.text === 'queued-msg').length, 1)
})

test('turn.completed from another session is ignored', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('turn.completed', { type: 'turn.completed', sessionID: 'other' })
  await settle()
  assert.equal(s.streaming, true, '他session的turn终态不影响')
  assert.equal(fx.calls.promptAsync.length, 1)
})

test('flushed queued turn is re-used (no duplicate user turn)', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's', onChange: () => {} })
  await s.send('first')
  const before = s.turns.length
  await s.send('second')
  s.applyEvent('turn.completed', { type: 'turn.completed' })
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

test('send passes agent to promptAsync when getAgent is set (slice 3 /plan /build)', async () => {
  const fx = fakeSession()
  const s = new ChatStore({
    session: fx as any, sessionID: 's', onChange: () => {},
    getAgent: () => 'plan',
  })
  await s.send('q')
  assert.equal(fx.calls.promptAsync[0].body.agent, 'plan')
})

test('send omits agent when getAgent returns null/undefined', async () => {
  const fx = fakeSession()
  const s = new ChatStore({
    session: fx as any, sessionID: 's', onChange: () => {},
    getAgent: () => undefined,
  })
  await s.send('q')
  assert.equal('agent' in fx.calls.promptAsync[0].body, false)
})

test('switchSession reloads history for the new session id', async () => {
  const fx = fakeSession()
  const s = new ChatStore({ session: fx as any, sessionID: 's1', onChange: () => {} })
  await s.loadHistory()
  assert.equal(s.sessionID, 's1')
  await s.switchSession('s2')
  assert.equal(s.sessionID, 's2')
  assert.equal(fx.calls.messages.at(-1).path.id, 's2')
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
  assert.equal(fx.calls.messages.at(-1).path.id, 's', 'undo 后重载历史')
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
test('part.delta 累积后 part.updated 终态快照替换同一 part（不重复）', () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  const delta = (text: string) => ({ type: 'part.delta', properties: { sessionID: 's', messageID: 'pia_9', partID: 'pia_9_t1', field: 'text', delta: text } })
  s.applyEvent('part.delta', delta('Hel'))
  s.applyEvent('part.delta', delta('lo'))
  assert.equal(s.turns.length, 1)
  assert.equal(s.turns[0].parts[0].text, 'Hello')
  // message_end 全量快照（同一 part id）→ 替换而非追加
  s.applyEvent('part.updated', { type: 'part.updated', properties: { part: { id: 'pia_9_t1', messageID: 'pia_9', sessionID: 's', type: 'text', text: 'Hello!' } } })
  assert.equal(s.turns[0].parts.length, 1)
  assert.equal(s.turns[0].parts[0].text, 'Hello!')
})

test('step 边界 / data-* part 不建幽灵回合（pi/opencode step-start、step-finish）', () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  for (const [id, type] of [['x1', 'step-start'], ['x2', 'step-finish'], ['x3', 'data-x'], ['x4', 'compaction']] as const) {
    s.applyEvent('part.updated', { type: 'part.updated', properties: { part: { id, type, messageID: 'pi_step_s', sessionID: 's' } } })
  }
  assert.equal(s.turns.length, 0)
})

test('message.updated 终态快照合并 + turn.completed 收尾 assistant（无幽灵 pending 回合）', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('q')
  s.applyEvent('part.delta', { type: 'part.delta', properties: { sessionID: 's', messageID: 'pia_1', partID: 'pia_1_t1', field: 'text', delta: 'Hel' } })
  s.applyEvent('message.updated', { type: 'message.updated', properties: { sessionID: 's', message: { id: 'pia_1', role: 'assistant', sessionID: 's', stopReason: 'end_turn', content: [{ id: 'pia_1_t1', type: 'text', text: 'Hello' }] } } })
  const assistant = s.turns.find(t => t.messageID === 'pia_1')!
  assert.equal(assistant.parts.length, 1)
  assert.equal(assistant.parts[0].text, 'Hello')
  assert.equal(assistant.done, false, '快照不自行收尾（终态由 turn.* 负责）')
  s.applyEvent('turn.completed', { type: 'turn.completed', sessionID: 's' })
  assert.equal(assistant.done, true)
  assert.equal(s.turns.filter(t => t.role === 'assistant').length, 1, '没有幽灵 assistant 回合')
})

test('turn.completed 收尾最后一个 assistant 回合（排队 user turn 排在其后也不误判）', async () => {
  const s = new ChatStore({ session: fakeSession() as any, sessionID: 's', onChange: () => {} })
  await s.send('first')
  s.applyEvent('part.delta', { type: 'part.delta', properties: { sessionID: 's', messageID: 'pia_2', partID: 'pia_2_t1', field: 'text', delta: 'hi' } })
  await s.send('second')
  assert.equal(s.turns.at(-1)!.role, 'user', '排队 user turn 在 assistant 之后')
  s.applyEvent('turn.completed', { type: 'turn.completed', sessionID: 's' })
  assert.equal(s.turns.find(t => t.messageID === 'pia_2')!.done, true)
})
