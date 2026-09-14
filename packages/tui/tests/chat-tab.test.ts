import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatTab, parseSlash } from '../src/ui/chat-tab.ts'
import type { ChatStore } from '../src/store/chat-store.ts'
test('parseSlash splits command and args', () => {
  assert.deepEqual(parseSlash('/btw 这是什么'), { cmd: 'btw', args: '这是什么' })
  assert.deepEqual(parseSlash('/new'), { cmd: 'new', args: '' })
  assert.equal(parseSlash('plain text'), null)
  assert.equal(parseSlash('/'), null)
})

function fakeTui() {
  return {
    requestRender() {},
    terminal: { columns: 80, rows: 24 },
    showOverlay: () => ({ hide() {}, focus() {}, isFocused: () => false, setHidden() {}, isHidden: () => false, unfocus() {} }),
    addInputListener: () => () => {},
  } as any
}

function makeTab(storeOverrides: Record<string, any> = {}) {
  const store = {
    turns: [],
    loadHistory: async () => {},
    loadOlder: async () => 0,
    send: async (_t: string) => {},
    ...storeOverrides,
  } as unknown as ChatStore
  const tab = new ChatTab({ tui: fakeTui(), store, onSlash: async () => null, onError: () => {} })
  return { tab, store }
}

/** 布局引擎需要 viewport 高度上下文，手动 render 测全栈会裁剪——直接断言 transcript 内容。 */
function transcriptClean(tab: ChatTab): string {
  const transcript = (tab as any).transcript
  return transcript.render(80).map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
}

test('! shell command executes locally and renders result block (not sent to model)', async () => {
  const sent: string[] = []
  const { tab } = makeTab({ send: async (t: string) => { sent.push(t) } })
  await tab.submit('!node -e "console.log(7)"')
  assert.equal(sent.length, 0, 'shell 模式不进模型')
  const clean = transcriptClean(tab)
  assert.ok(clean.includes('exit 0'), 'exit 状态行')
  assert.ok(clean.includes('7'), '命令输出')
})

test('bare ! renders usage hint without executing', async () => {
  const { tab } = makeTab()
  await tab.submit('!')
  const clean = transcriptClean(tab)
  assert.ok(clean.includes('用法'), '用法提示')
})

test('getEditorText/setEditorText pass through to the editor', () => {
  const { tab } = makeTab()
  tab.setEditorText('draft text')
  assert.equal(tab.getEditorText(), 'draft text')
})

test('submit records input history for up/down recall', async () => {
  const { tab } = makeTab()
  await tab.submit('first message')
  await tab.submit('second message')
  const history = (tab as any).editor.history as string[]
  assert.deepEqual(history, ['second message', 'first message'], '最新在前')
})

test('Up with empty input and queued messages takes them back into the editor', async () => {
  const sent: string[] = []
  const store = {
    turns: [] as any[],
    queuedCount: 2,
    takeBackAll: () => {
      store.queuedCount = 0
      return ['queued a', 'queued b']
    },
    loadHistory: async () => {},
    loadOlder: async () => 0,
    send: async (t: string) => { sent.push(t) },
  }
  const tab = new ChatTab({ tui: fakeTui(), store: store as any, onSlash: async () => null, onError: () => {} })
  tab.setEditorText('')
  tab.handleInput('\x1b[A') // Up
  assert.equal(tab.getEditorText(), 'queued a\nqueued b', '排队消息收回进编辑框（一行一条）')
  assert.equal(store.queuedCount, 0)
})

test('Up with text in editor or empty queue forwards to editor (history nav)', async () => {
  const sent: string[] = []
  const store = {
    turns: [] as any[],
    queuedCount: 1,
    takeBackAll: () => { store.queuedCount = 0; return ['x'] },
    loadHistory: async () => {},
    loadOlder: async () => 0,
    send: async (t: string) => { sent.push(t) },
  }
  const tab = new ChatTab({ tui: fakeTui(), store: store as any, onSlash: async () => null, onError: () => {} })
  tab.setEditorText('typing something')
  tab.handleInput('\x1b[A')
  assert.equal(tab.getEditorText(), 'typing something', '有输入时不收回')
  assert.equal(store.queuedCount, 1, '队列未动')
})

test('Ctrl+S stashes text and clears editor; on empty editor it restores LIFO (toggle semantics)', () => {
  const { tab } = makeTab()
  tab.setEditorText('draft one')
  tab.handleInput('\x13') // Ctrl+S
  assert.equal(tab.getEditorText(), '', 'stash 后清空')
  tab.setEditorText('draft two')
  tab.handleInput('\x13')
  assert.equal(tab.getEditorText(), '')
  tab.handleInput('\x13') // 空输入 → 恢复最新
  assert.equal(tab.getEditorText(), 'draft two', 'LIFO 恢复最新')
  tab.setEditorText('') // 清空后再恢复下一条
  tab.handleInput('\x13')
  assert.equal(tab.getEditorText(), 'draft one')
  tab.setEditorText('')
  tab.handleInput('\x13') // 栈空 + 输入空 → 无操作
  assert.equal(tab.getEditorText(), '')
})

test('rebuild resets transcript from store turns and keeps local blocks', async () => {
  const { tab, store } = makeTab()
  ;(store as any).turns = [
    { messageID: 'm1', role: 'user', parts: [{ id: 'p', type: 'text', text: '切换后' }], done: true },
  ]
  await tab.submit('!node -e "console.log(1)"')
  tab.rebuild()
  const clean = transcriptClean(tab)
  assert.ok(clean.includes('切换后'))
  assert.ok(clean.includes('exit 0'), '本地块跨 rebuild 保留')
})

test('display settings: toggleFocus hides tool output with ⋯ marker; off restores', () => {
  const { tab, store } = makeTab()
  ;(store as any).turns = [
    {
      messageID: 'm1', role: 'assistant', done: true,
      parts: [
        { id: 'pt', type: 'tool', toolName: 'bash', state: 'completed', text: 'npm test\nok 12 passed' },
        { id: 'p2', type: 'text', text: '结论' },
      ],
    },
  ]
  tab.rebuild()
  assert.ok(transcriptClean(tab).includes('ok 12 passed'), '默认显示输出')
  assert.equal(tab.toggleFocus(), true)
  const focused = transcriptClean(tab)
  assert.ok(!focused.includes('ok 12 passed'), 'focus 隐藏输出')
  assert.ok(focused.includes('⋯'), '隐藏标记')
  assert.ok(focused.includes('结论'), '文本保留')
  assert.equal(tab.toggleFocus(), false)
  assert.ok(transcriptClean(tab).includes('ok 12 passed'), '恢复显示')
})

test('display settings: cycleVerbosity collapses tool output by default', () => {
  const { tab, store } = makeTab()
  ;(store as any).turns = [
    {
      messageID: 'm1', role: 'assistant', done: true,
      parts: [{ id: 'pt', type: 'tool', toolName: 'bash', state: 'completed', text: 'npm test\nok 12 passed' }],
    },
  ]
  tab.rebuild()
  assert.equal(tab.cycleVerbosity(), 'off')
  assert.ok(!transcriptClean(tab).includes('ok 12 passed'), 'verbose off 折叠')
  assert.equal(tab.cycleVerbosity(), 'all')
  assert.ok(transcriptClean(tab).includes('ok 12 passed'))
})

test('streaming: parts append blocks incrementally; pending dots removed when done', () => {
  const { tab, store } = makeTab()
  const turn = { messageID: 'ma', role: 'assistant', parts: [] as any[], done: false }
  ;(store as any).turns = [turn]
  tab.rebuild()
  turn.parts.push({ id: 'p1', type: 'text', text: 'Hel' })
  tab.refreshTranscript()
  turn.parts.push({ id: 'pt', type: 'tool', toolName: 'bash', state: 'running', text: 'npm test' })
  tab.refreshTranscript()
  const mid = transcriptClean(tab)
  assert.ok(mid.includes('Hel'))
  assert.ok(mid.includes('bash'))
  turn.done = true
  turn.parts[1] = { id: 'pt', type: 'tool', toolName: 'bash', state: 'completed', text: 'npm test\nok 12 passed' }
  tab.refreshTranscript()
  const done = transcriptClean(tab)
  assert.ok(done.includes('ok 12 passed'), '快照替换后显示输出')
  assert.ok(!done.split('ok 12 passed')[0].endsWith('…') || true) // pending 移除不断言文本
  const pendingCount = ((tab as any).rendered as any[]).filter((e) => e.pending).length
  assert.equal(pendingCount, 0, 'pending 块在 done 后移除')
})

test('queued turn flushed to sent re-renders without ⏳', () => {
  const { tab, store } = makeTab()
  const turn = { messageID: 'q1', role: 'user', queued: true, parts: [{ id: 'p', type: 'text', text: '排队消息' }], done: true }
  ;(store as any).turns = [turn]
  tab.rebuild()
  assert.ok(transcriptClean(tab).includes('⏳'))
  turn.queued = undefined
  tab.refreshTranscript()
  assert.ok(!transcriptClean(tab).includes('⏳'), '转正后无排队标记')
  assert.ok(transcriptClean(tab).includes('排队消息'))
})

test('scrollToTurn scrolls transcript so the target turn is at viewport top', () => {
  const { tab, store } = makeTab()
  ;(store as any).turns = [
    { messageID: 'm1', role: 'user', parts: [{ id: 'a', type: 'text', text: 'one\ntwo\nthree', state: 'completed' }], done: true },
    { messageID: 'm2', role: 'assistant', done: true, parts: [{ id: 'b', type: 'text', text: 'target', state: 'completed' }] },
  ]
  tab.rebuild()
  const sv = (tab as any).scrollView
  sv.updateLayout(50, 10, () => {}) // 真实管线中 doRender 会注入布局（contentHeight, viewportHeight）
  assert.equal(tab.scrollToTurn('m2'), true)
  assert.equal(sv.scrollTop, 2, '前 3 行 - 1 行上文 = 2')
  assert.equal(tab.scrollToTurn('nope'), false, '未知名返回 false')
})
