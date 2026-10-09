import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VStack, type Component } from '@earendil-works/pi-tui'
// @ts-ignore 直接引 dist 内部模块（同 layout-probe）
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { EditorFrame, isBorderLine } from '../src/ui/editor-frame.ts'
import { StatusBar } from '../src/ui/status-bar.ts'
import { ChatTab } from '../src/ui/chat-tab.ts'
import type { ChatStore } from '../src/store/chat-store.ts'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

class FakeInner implements Component {
  private lines: string[]
  constructor(lines: string[]) { this.lines = lines }
  invalidate() {}
  render(_width: number): string[] { return this.lines.slice() }
}

function fakeTui(rows: number, columns = 80) {
  return {
    requestRender() {},
    terminal: { columns, rows },
    showOverlay: () => ({ hide() {}, focus() {}, isFocused: () => false, setHidden() {}, isHidden: () => false, unfocus() {} }),
    addInputListener: () => () => {},
  } as any
}

// ── EditorFrame ──

test('isBorderLine recognizes box-drawing border rows, not text', () => {
  assert.ok(isBorderLine('────────────────────'))
  assert.ok(isBorderLine('\x1b[2m──── ↑ 3 more ────\x1b[0m'), 'scroll indicator 也是边框')
  assert.ok(!isBorderLine('line1'))
  assert.ok(!isBorderLine('  这是一个输入行  '))
})

test('EditorFrame passes through when content fits budget', () => {
  const frame = new EditorFrame(new FakeInner(['TOP', 'c1', 'BOT']), fakeTui(24))
  assert.deepEqual(frame.render(80), ['TOP', 'c1', 'BOT'])
})

test('EditorFrame caps to budget keeping box closed (short terminal)', () => {
  const inner = new FakeInner(['────', 'c1', 'c2', 'c3', 'c4', 'c5', '────'])
  const frame = new EditorFrame(inner, fakeTui(8)) // budget = max(3, 8-3) = 5
  const out = frame.render(80)
  assert.equal(out.length, 5)
  assert.ok(isBorderLine(out[0]), '顶边框保留')
  assert.ok(isBorderLine(out[out.length - 1]), '底边框保留（不开口）')
})

test('EditorFrame keeps typed line + autocomplete within budget', () => {
  const inner = new FakeInner(['────', '/', '────', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
  const frame = new EditorFrame(inner, fakeTui(10)) // budget = 7
  const out = frame.render(80)
  assert.equal(out.length, 7)
  const clean = out.map(strip)
  assert.ok(clean.includes('/'), '保留已输入行')
  assert.ok(clean.some((l) => isBorderLine(l)), '保留底边框')
  assert.ok(clean.includes('a1'), '补全项可见')
})

// ── StatusBar 窄列优先级 ──

test('StatusBar narrow width keeps usage, drops low-value placeholders', () => {
  const bar = new StatusBar()
  bar.setState({ project: '-', session: '-', conn: 'ok', usage: { model: 'qwen3.7-max', tokens: 12_300, costUsd: 0.06 } })
  const clean = strip(bar.render(30)[0])
  assert.ok(clean.includes('qwen3.7-max') || clean.includes('12.3K'), `usage 应保留: ${clean}`)
  assert.ok(!clean.includes('-  ·'), `占位 - 段应先删: ${clean}`)
})

// ── ChatTab 集成：矮窗口输入框不开口 ──

function chatRoot(columns: number, rows: number) {
  const store = {
    turns: [], loadHistory: async () => {}, loadOlder: async () => 0, send: async () => {},
    queuedCount: 0, takeBackAll: () => [],
  } as unknown as ChatStore
  const tab = new ChatTab({ tui: fakeTui(rows, columns), store, onSlash: async () => null, onError: () => {} })
  const host = new VStack([])
  host.addChild(tab, { basis: 0, grow: 1, minSize: 1 })
  const root = new VStack([
    { component: new (class { invalidate() {} render() { return ['TABSTRIP'] } })(), basis: 'auto', minSize: 1 },
    { component: host, basis: 0, grow: 1, minSize: 1 },
    { component: new StatusBar(), basis: 'auto', minSize: 1 },
  ])
  return { root, tab }
}

test('ChatTab narrows autocomplete maxVisible on short terminals', () => {
  const short = chatRoot(80, 10)
  short.tab.render(80)
  assert.equal((short.tab as any).editor.getAutocompleteMaxVisible(), 3)
  const tall = chatRoot(80, 24)
  tall.tab.render(80)
  assert.equal((tall.tab as any).editor.getAutocompleteMaxVisible(), 5)
})

test('ChatTab short terminal: multi-line editor keeps closing border (no open box)', () => {
  const { root, tab } = chatRoot(80, 8)
  tab.setEditorText('line1\nline2\nline3\nline4\nline5')
  const frame = renderLayoutFrame(root, 80, 8, () => {})
  const clean = frame.lines.map(strip)
  // 状态栏在最后一行；其上一行应是输入框底边框（闭合），而不是被硬切的输入行
  const aboveStatus = clean[clean.length - 2]
  assert.ok(isBorderLine(aboveStatus), `输入框应闭合，实际: |${aboveStatus}|`)
})
