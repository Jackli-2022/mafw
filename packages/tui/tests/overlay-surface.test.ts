import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import {
  TuiAltScreen, Text, visibleWidth,
  type Terminal, type Component,
} from '@earendil-works/pi-tui'
import { OverlaySurface, showModal } from '../src/ui/overlay-surface.ts'
import { ConfirmOverlay, type ConfirmAnswer } from '../src/ui/confirm-overlay.ts'

chalk.level = 3

/** 最小 Terminal 假件（同 mouse.test.ts）。 */
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

/** 记录调用的假组件。 */
class FakeInner implements Component {
  inputs: string[] = []
  clicks: { col: number; row: number }[] = []
  invalidated = 0
  clickResult = true
  renderLines: string[] = ['inner line']
  render(_width: number): string[] { return this.renderLines }
  invalidate(): void { this.invalidated++ }
  handleInput(data: string): void { this.inputs.push(data) }
  handleMouseClick(col: number, row: number): boolean {
    this.clicks.push({ col, row })
    return this.clickResult
  }
}

const BG = '48;5;235'

// ── 背景填充 ──

test('overlay surface fills every row with opaque background at full width', () => {
  const surface = new OverlaySurface(new FakeInner())
  const lines = surface.render(20)
  assert.ok(lines.length >= 3, '上下 padding 行必须存在')
  for (const line of lines) {
    assert.equal(visibleWidth(line), 20, '每行必须铺满声明的宽度')
    assert.ok(line.includes(BG), `行必须带背景色：${JSON.stringify(line)}`)
  }
})

test('overlay surface background covers short content rows (no bleed-through)', () => {
  const inner = new FakeInner()
  inner.renderLines = ['ab'] // 内容远窄于宽度
  const surface = new OverlaySurface(inner)
  const lines = surface.render(30)
  for (const line of lines) {
    assert.equal(visibleWidth(line), 30)
    assert.ok(line.includes(BG))
  }
})

// ── 转发 ──

test('overlay surface forwards handleInput and invalidate to inner', () => {
  const inner = new FakeInner()
  const surface = new OverlaySurface(inner)
  surface.handleInput('j')
  surface.handleInput('\r')
  surface.invalidate()
  assert.deepEqual(inner.inputs, ['j', '\r'])
  assert.equal(inner.invalidated, 1)
})

test('overlay surface forwards handleMouseClick with padding offset', () => {
  const inner = new FakeInner()
  const surface = new OverlaySurface(inner) // padX=1, padY=1
  assert.equal(surface.handleMouseClick(3, 4), true)
  assert.deepEqual(inner.clicks, [{ col: 2, row: 3 }])
})

test('overlay surface handleMouseClick returns false when inner declines', () => {
  const inner = new FakeInner()
  inner.clickResult = false
  const surface = new OverlaySurface(inner)
  assert.equal(surface.handleMouseClick(3, 4), false)
})

// ── 集成：compositeOverlays 之后不透底 ──

test('compositeOverlays: wrapped overlay rows are bg-filled and hide base content', () => {
  const term = new FakeTerminal()
  const tui = new TuiAltScreen(term)
  const inner = new FakeInner()
  inner.renderLines = ['dialog text']
  showModal(tui, inner, { width: 24, anchor: 'center' })
  const base = ['transcript line', 'another transcript line']
  const out = (tui as any).compositeOverlays([...base], 80, 24) as string[]
  const overlayRows = out.filter((l) => l.includes(BG))
  assert.ok(overlayRows.length >= 3, '合成结果必须包含带背景的 overlay 行')
  for (const row of overlayRows) {
    assert.ok(!row.includes('transcript'), 'overlay 区域不得透出底层内容')
  }
})

test('compositeOverlays: unwrapped overlay stays transparent (documents the old bug)', () => {
  const term = new FakeTerminal()
  const tui = new TuiAltScreen(term)
  const inner = new FakeInner()
  inner.renderLines = ['dialog text']
  tui.showOverlay(inner, { width: 24, anchor: 'center' })
  const base = ['transcript line']
  const out = (tui as any).compositeOverlays([...base], 80, 24) as string[]
  const overlayRows = out.filter((l) => l.includes('dialog text'))
  assert.ok(overlayRows.length === 1)
  assert.ok(!overlayRows[0].includes(BG), '未包装组件无背景（根因对照）')
})

test('showModal returns a working handle; hide removes the overlay', () => {
  const term = new FakeTerminal()
  const tui = new TuiAltScreen(term)
  const handle = showModal(tui, new FakeInner(), { width: 24, anchor: 'center' })
  assert.equal(typeof handle.hide, 'function')
  assert.equal((tui as any).overlayStack.length, 1)
  handle.hide()
  assert.equal((tui as any).overlayStack.length, 0)
})

// ── mafw_confirm 回归：包装后键盘流仍可用 ──

test('ConfirmOverlay inside surface: Enter answers once', () => {
  const answers: ConfirmAnswer[] = []
  const confirm = new ConfirmOverlay({
    title: '确认',
    onAnswer: (m) => answers.push(m),
    requestRender: () => {},
  })
  const surface = new OverlaySurface(confirm)
  surface.handleInput('\r') // Enter → selected=0 → once
  assert.deepEqual(answers, ['once'])
})
