/* 小窗口布局复现探针：直接驱动 pi-tui renderLayoutFrame 快照真实帧。用完即删。 */
import { VStack } from '@earendil-works/pi-tui'
// @ts-ignore 直接引 dist 内部模块
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { TabStrip } from './src/ui/tab-strip.ts'
import { StatusBar } from './src/ui/status-bar.ts'
import { ChatTab } from './src/ui/chat-tab.ts'
import type { ChatStore } from './src/store/chat-store.ts'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

function fakeTui(columns: number, rows: number) {
  return {
    requestRender() {},
    terminal: { columns, rows },
    showOverlay: () => ({ hide() {}, focus() {}, isFocused: () => false, setHidden() {}, isHidden: () => false, unfocus() {} }),
    addInputListener: () => () => {},
  } as any
}

function makeRoot(columns: number, rows: number) {
  const tabStrip = new TabStrip()
  tabStrip.setConnected(true)
  const statusBar = new StatusBar()
  statusBar.setState({
    model: 'qwen3.7-max', tokens: '12.3K', cost: '$0.06', duration: '3m 20s',
    queued: 2, stash: 1, busy: true, perm: 'auto', agent: 'plan',
  } as any)
  const store = {
    turns: [],
    loadHistory: async () => {},
    loadOlder: async () => 0,
    send: async () => {},
    queuedCount: 0,
    takeBackAll: () => [],
  } as unknown as ChatStore
  const chatTab = new ChatTab({ tui: fakeTui(columns, rows), store, onSlash: async () => null, onError: () => {} })
  const contentHost = new VStack([])
  contentHost.addChild(chatTab, { basis: 0, grow: 1, minSize: 1 })
  const root = new VStack([
    { component: tabStrip, basis: 'auto', minSize: 1 },
    { component: contentHost, basis: 0, grow: 1, minSize: 1 },
    { component: statusBar, basis: 'auto', minSize: 1 },
  ])
  return { root, tab: chatTab }
}

async function snap(columns: number, rows: number, prep?: (tab: ChatTab) => void | Promise<void>) {
  const { root, tab } = makeRoot(columns, rows)
  if (prep) await prep(tab)
  const frame = renderLayoutFrame(root, columns, rows, () => {})
  console.log(`\n===== ${columns}x${rows} =====`)
  frame.lines.forEach((l: string, i: number) => {
    console.log(`${String(i).padStart(2)}|${strip(l)}|`)
  })
}

const tick = () => new Promise((r) => setTimeout(r, 60))
const longInput = 'line1\nline2\nline3\nline4\nline5'

// 现实小窗口（带补全）
for (const [c, r] of [[80, 16], [70, 14], [60, 12], [80, 10]] as const) {
  await snap(c, r, async (tab) => { tab.handleInput('/'); await tick() })
}
// 现实小窗口（多行输入）
for (const [c, r] of [[80, 16], [80, 10], [80, 8]] as const) {
  await snap(c, r, (tab) => tab.setEditorText(longInput))
}
