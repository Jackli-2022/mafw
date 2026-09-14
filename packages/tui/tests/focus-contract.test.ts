import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TuiAltScreen, VStack, type Terminal } from '@earendil-works/pi-tui'
import { ChatTab } from '../src/ui/chat-tab.ts'
import type { ChatStore } from '../src/store/chat-store.ts'

/** 最小 Terminal 假件：实现 pi-tui Terminal 接口，捕获输入回调。 */
class FakeTerminal implements Terminal {
  columns = 80
  rows = 24
  private onInput?: (data: string) => void
  start(onInput: (data: string) => void, _onResize: () => void): void { this.onInput = onInput }
  stop(): void { this.onInput = undefined }
  async drainInput(): Promise<void> {}
  write(_data: string): void {}
  get kittyProtocolActive(): boolean { return false }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_t: string): void {}
  setProgress(_a: boolean): void {}
  /** 测试注入：模拟用户按键。 */
  type(data: string): void { this.onInput?.(data) }
}

function makeStore(): ChatStore {
  return { turns: [], loadHistory: async () => {}, loadOlder: async () => 0, send: async () => {} } as unknown as ChatStore
}

function buildApp() {
  const terminal = new FakeTerminal()
  const tui = new TuiAltScreen(terminal)
  const chatTab = new ChatTab({ tui, store: makeStore(), onSlash: async () => null, onError: () => {} })
  // 与 app.ts 相同的布局结构：TabStrip(auto) / 内容区(grow) / StatusBar(auto) —— 用 Text 占位
  const host = new VStack([])
  host.addChild(chatTab, { basis: 0, grow: 1, minSize: 1 })
  tui.setLayoutRoot(new VStack([
    { component: host, basis: 0, grow: 1, minSize: 1 },
  ]))
  return { terminal, tui, chatTab }
}

test('启动未聚焦时按键被丢弃（"tui 没法输入"根因复现）', () => {
  const { terminal, tui, chatTab } = buildApp()
  tui.start()
  terminal.type('x')
  assert.equal(chatTab.getEditorText(), '', '无焦点时按键无处去')
  tui.stop()
})

test('启动即 setFocus(chatTab)（applyTab 语义）后，按键经真实管线进入编辑器', () => {
  const { terminal, tui, chatTab } = buildApp()
  tui.setFocus(chatTab) // ← app.ts 启动时 applyTab() 应做的等价动作
  tui.start()
  terminal.type('h')
  terminal.type('i')
  assert.equal(chatTab.getEditorText(), 'hi', '按键到达编辑器')
  tui.stop()
})
