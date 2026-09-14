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
