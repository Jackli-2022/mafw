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
