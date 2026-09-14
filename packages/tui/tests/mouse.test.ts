import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import {
  TuiAltScreen, VStack, Text, SelectList,
  type Terminal, type Component, type SelectItem,
} from '@earendil-works/pi-tui'
import { enableClickDispatch } from '../src/ui/clickable-tui.ts'
import { ClickableSelectList, HeaderSelectOverlay } from '../src/ui/clickable-select-list.ts'
import { TabStrip, type TabId } from '../src/ui/tab-strip.ts'
import { selectListTheme } from '../src/ui/chat-tab.ts'
import { ChatTab } from '../src/ui/chat-tab.ts'
import { GoalsTab } from '../src/ui/goals-tab.ts'
import { TriageTab } from '../src/ui/triage-tab.ts'
import { MemoryTab } from '../src/ui/memory-tab.ts'
import type { ChatStore } from '../src/store/chat-store.ts'
import type { GoalsStore } from '../src/store/goals-store.ts'
import type { TriageStore } from '../src/store/triage-store.ts'
import type { MemoryStore } from '../src/store/memory-store.ts'

chalk.level = 3

/** 最小 Terminal 假件（同 focus-contract.test.ts）。 */
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
  type(data: string): void { this.onInput?.(data) }
}

/** SGR 左键按下序列（0-based 坐标）。 */
const click = (t: FakeTerminal, x: number, y: number) => t.type(`\x1b[<0;${x + 1};${y + 1}M`)

function items(n: number): SelectItem[] {
  return Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `item ${i}` }))
}

// ── TabStrip 点击 ──

test('tab strip clickAt maps column to tab; separators/edge miss', () => {
  const strip = new TabStrip()
  strip.render(80)
  assert.equal(strip.clickAt(0), 'chat')
  assert.equal(strip.clickAt(7), 'chat')
  assert.equal(strip.clickAt(8), null, '分隔符不可点')
  assert.equal(strip.clickAt(9), 'goals')
  assert.equal(strip.clickAt(17), 'goals')
  assert.equal(strip.clickAt(18), null, '分隔符不可点')
  assert.equal(strip.clickAt(19), 'memory')
  assert.equal(strip.clickAt(30), 'triage')
  assert.equal(strip.clickAt(60), null, 'gateway 指示区不可点')
})

test('tab strip handleMouseClick fires onTabClick', () => {
  const strip = new TabStrip()
  const clicked: TabId[] = []
  strip.onTabClick = (id) => clicked.push(id)
  assert.equal(strip.handleMouseClick(9, 0), true)
  assert.equal(strip.handleMouseClick(8, 0), false)
  assert.deepEqual(clicked, ['goals'])
})

// ── ClickableSelectList ──

test('clickable select list: click visible row selects and activates', () => {
  const picked: SelectItem[] = []
  const list = new SelectList(items(3), 5, selectListTheme)
  list.onSelect = (item) => picked.push(item)
  const wrap = new ClickableSelectList(list)
  assert.equal(wrap.handleMouseClick(1, 1), true)
  assert.equal(picked.length, 1)
  assert.equal(picked[0].value, 'v1')
  assert.equal((list as any).selectedIndex, 1)
})

test('clickable select list respects visible window; scroll-info row is not clickable', () => {
  const picked: SelectItem[] = []
  const list = new SelectList(items(10), 3, selectListTheme)
  list.onSelect = (item) => picked.push(item)
  const wrap = new ClickableSelectList(list)
  assert.equal(wrap.handleMouseClick(1, 2), true)
  assert.equal(picked[0].value, 'v2')
  assert.equal(wrap.handleMouseClick(1, 3), false, '第 4 行是滚动指示，不可点')
  assert.equal(wrap.handleMouseClick(1, 9), false, '越界不可点')
})

test('header select overlay: header row not clickable, list rows are', () => {
  const picked: SelectItem[] = []
  const list = new SelectList(items(3), 5, selectListTheme)
  list.onSelect = (item) => picked.push(item)
  const overlay = new HeaderSelectOverlay(new Text('标题', 1, 1), list)
  const headerLines = overlay.render(60).length - list.render(60).length
  assert.ok(headerLines >= 1)
  assert.equal(overlay.handleMouseClick(1, headerLines - 1), false, 'header 行不可点')
  assert.equal(overlay.handleMouseClick(1, headerLines + 1), true)
  assert.equal(picked[0].value, 'v1')
})

// ── ClickableTui 派发（真实输入管线 + 布局树） ──

class SpyBox implements Component {
  hits: string[] = []
  render(): string[] { return ['box'] }
  invalidate(): void {}
  handleMouseClick(col: number, row: number): boolean {
    this.hits.push(`${col},${row}`)
    return true
  }
}

test('enableClickDispatch: base-layout click reaches hit component with local coords', () => {
  const terminal = new FakeTerminal()
  const tui = new TuiAltScreen(terminal)
  enableClickDispatch(tui)
  const spy = new SpyBox()
  const host = new VStack([])
  host.addChild(spy, { basis: 0, grow: 1, minSize: 1 })
  tui.setLayoutRoot(new VStack([{ component: host, basis: 0, grow: 1, minSize: 1 }]))
  tui.start()
  tui.renderNow(true)
  click(terminal, 5, 3)
  assert.deepEqual(spy.hits, ['5,3'])
  tui.stop()
})

test('enableClickDispatch: tab strip click switches tab via onTabClick (full pipeline)', () => {
  const terminal = new FakeTerminal()
  const tui = new TuiAltScreen(terminal)
  enableClickDispatch(tui)
  const strip = new TabStrip()
  const switched: TabId[] = []
  strip.onTabClick = (id) => switched.push(id)
  const host = new VStack([])
  host.addChild(new Text('content'), { basis: 0, grow: 1, minSize: 1 })
  tui.setLayoutRoot(new VStack([
    { component: strip, basis: 'auto', minSize: 1 },
    { component: host, basis: 0, grow: 1, minSize: 1 },
  ]))
  tui.start()
  tui.renderNow(true)
  click(terminal, 10, 0)
  assert.deepEqual(switched, ['goals'])
  tui.stop()
})

test('enableClickDispatch: overlay is modal — inside click activates, outside click swallowed', () => {
  const terminal = new FakeTerminal()
  const tui = new TuiAltScreen(terminal)
  enableClickDispatch(tui)
  const spy = new SpyBox()
  const host = new VStack([])
  host.addChild(spy, { basis: 0, grow: 1, minSize: 1 })
  tui.setLayoutRoot(new VStack([{ component: host, basis: 0, grow: 1, minSize: 1 }]))
  tui.start()
  tui.renderNow(true)

  const picked: SelectItem[] = []
  const list = new SelectList(items(3), 5, selectListTheme)
  list.onSelect = (item) => picked.push(item)
  // width 30 / 3 行 / center → col=25, row=10；点 (26,11) → 局部 (1,1) → v1
  tui.showOverlay(new ClickableSelectList(list), { width: 30, anchor: 'center' })
  tui.renderNow(true)
  click(terminal, 26, 11)
  assert.equal(picked.length, 1)
  assert.equal(picked[0].value, 'v1')

  click(terminal, 2, 22) // overlay 外
  assert.equal(spy.hits.length, 0, '模态：外部点击不落到底层组件')
  tui.stop()
})

// ── ChatTab 点击聚焦 ──

test('chat tab click focuses editor chain; repeat click allows selection', () => {
  const terminal = new FakeTerminal()
  const tui = new TuiAltScreen(terminal)
  enableClickDispatch(tui)
  const store = { turns: [], loadHistory: async () => {}, loadOlder: async () => 0, send: async () => {} } as unknown as ChatStore
  const chatTab = new ChatTab({ tui, store, onSlash: async () => null, onError: () => {} })
  const host = new VStack([])
  host.addChild(chatTab, { basis: 0, grow: 1, minSize: 1 })
  tui.setLayoutRoot(new VStack([{ component: host, basis: 0, grow: 1, minSize: 1 }]))
  tui.start()
  tui.renderNow(true)
  assert.equal(tui.getFocusedComponent(), null, '未聚焦起点')
  click(terminal, 10, 10)
  assert.equal(tui.getFocusedComponent(), chatTab, '点击后聚焦')
  assert.equal(chatTab.handleMouseClick(0, 0), false, '已聚焦时放行（保留拖选）')
  tui.stop()
})

// ── 列表 tab 行点击 ──

function fakeGoalsTui() {
  return { requestRender() {}, showOverlay: () => ({ hide() {} }), addInputListener: () => () => {} } as any
}

function makeGoalsTab() {
  const rows = [
    { goalId: 'g1', phase: 'EXECUTING', loop: 1, currentWave: 1, totalWaves: 2 },
    { goalId: 'g2', phase: 'PLANNING', loop: 1, currentWave: 1, totalWaves: 1 },
  ]
  const questions = [{ id: 'q1', questions: [{ question: '问题一', options: [] }] }]
  const store = { rows, questions, start: () => {}, stop: () => {} } as unknown as GoalsStore
  const client = { goals: { get: async () => null, control: async () => {}, sessions: async () => [] } }
  const tab = new GoalsTab({ tui: fakeGoalsTui(), store, client, setStatus: () => {} } as any)
  return { tab, store }
}

test('goals tab click selects goal row / question row; header not clickable', () => {
  const { tab } = makeGoalsTab()
  tab.render(80)
  assert.equal(tab.handleMouseClick(0, 0), false, 'header')
  assert.equal(tab.handleMouseClick(0, 1), true, 'goal 行 1')
  assert.equal((tab as any).selected, 0)
  assert.equal(tab.handleMouseClick(0, 2), true, 'goal 行 2')
  assert.equal((tab as any).selected, 1)
  // rows=2 → 空行 3，问头 4，问行 5
  assert.equal(tab.handleMouseClick(0, 3), false, '空行')
  assert.equal(tab.handleMouseClick(0, 4), false, '问头')
  assert.equal(tab.handleMouseClick(0, 5), true, '问行')
  assert.equal((tab as any).selected, 2, '问答区 selection 偏移 = rowCount')
})

function makeTriageTab() {
  const approvals = [{ id: 'a1', question: '审批一', goalId: 'g1' }]
  const items = [
    { id: 't1', severity: 'high', reason: '原因一', goalId: 'g1' },
    { id: 't2', severity: 'low', reason: '原因二', goalId: 'g2' },
  ]
  const store = { approvals, items, start: () => {}, stop: () => {}, act: async () => {} } as unknown as TriageStore
  const tab = new TriageTab({ tui: fakeGoalsTui(), store, client: {}, setStatus: () => {} } as any)
  return { tab }
}

test('triage tab click selects approval / item rows with placeholder-aware mapping', () => {
  const { tab } = makeTriageTab()
  tab.render(80)
  assert.equal(tab.handleMouseClick(0, 0), false, 'approvals header')
  assert.equal(tab.handleMouseClick(0, 1), true)
  assert.equal((tab as any).selected, 0)
  // approvals=1 → 空行 2，triage header 3，items 4..5
  assert.equal(tab.handleMouseClick(0, 3), false, 'triage header')
  assert.equal(tab.handleMouseClick(0, 4), true)
  assert.equal((tab as any).selected, 1, 'item 行 → selection 偏移 approvalCount')
  assert.equal(tab.handleMouseClick(0, 5), true)
  assert.equal((tab as any).selected, 2)
})

function makeMemoryTab() {
  const results = [
    { id: 'm1', type: 'semantic', primary_abstraction: '记忆一', energy: 0.8 },
    { id: 'm2', type: 'episodic', primary_abstraction: '记忆二', energy: 0.6 },
  ]
  const sticky = [{ id: 's1', type: 'semantic', primary_abstraction: '便签一', energy: 0.9 }]
  const store = {
    results, sticky, budget: { max: 10, maxChars: 800, used: 1 },
    refreshSticky: async () => {}, search: async () => {}, unstick: async () => {},
  } as unknown as MemoryStore
  const tab = new MemoryTab({ tui: fakeGoalsTui(), store, client: {} as any, setStatus: () => {}, setEditing: () => {} })
  return { tab }
}

test('memory tab click selects result / sticky rows', () => {
  const { tab } = makeMemoryTab()
  tab.refresh()
  assert.equal(tab.handleMouseClick(0, 0), false, '搜索提示行')
  assert.equal(tab.handleMouseClick(0, 1), false, '结果 header')
  assert.equal(tab.handleMouseClick(0, 2), true)
  assert.equal((tab as any).selected, 0)
  assert.equal(tab.handleMouseClick(0, 3), true)
  assert.equal((tab as any).selected, 1)
  // results=2 → 空行 4，便签头 5，便签行 6
  assert.equal(tab.handleMouseClick(0, 5), false, '便签 header')
  assert.equal(tab.handleMouseClick(0, 6), true)
  assert.equal((tab as any).selected, 2, '便签行 → selection 偏移 resultCount')
})
