import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { QueueOverlay } from '../src/ui/queue-overlay.ts'

chalk.level = 3

function makeOverlay(items: string[] = ['first queued', 'second queued']) {
  const taken: number[] = []
  const dropped: number[] = []
  let closed = 0
  const overlay = new QueueOverlay({
    getItems: () => items,
    onTakeBack: (i) => taken.push(i),
    onDrop: (i) => dropped.push(i),
    onClose: () => { closed++ },
    requestRender: () => {},
  })
  return { overlay, taken, dropped, get closed() { return closed } }
}

test('renders queue items with index and selection marker', () => {
  const { overlay } = makeOverlay()
  const clean = overlay.render(60).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('排队消息'))
  assert.ok(clean.includes('first queued'))
  assert.ok(clean.includes('second queued'))
  assert.ok(clean.includes('Enter 收回'), '按键提示')
})

test('empty queue renders placeholder and any key closes', () => {
  const h = makeOverlay([])
  const clean = h.overlay.render(60).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('（队列为空'))
  h.overlay.handleInput('\x1b') // Esc
  assert.equal(h.closed, 1)
})

test('j/k move selection; Enter take-back (and closes); d drop; Esc close', () => {
  const a = makeOverlay()
  a.overlay.handleInput('j') // 下移到第 2 条
  a.overlay.handleInput('\r') // Enter 收回第 2 条（index 1）并关闭
  assert.deepEqual(a.taken, [1])
  assert.equal(a.closed, 1, '收回后 overlay 关闭')

  const b = makeOverlay()
  b.overlay.handleInput('d') // 丢弃当前选中（第 1 条）
  assert.deepEqual(b.dropped, [0])
  assert.equal(b.closed, 0, '丢弃后留在列表')

  const c = makeOverlay()
  c.overlay.handleInput('\x1b')
  assert.equal(c.closed, 1)
})

test('up/down arrows also move selection (wrap not required)', () => {
  const { overlay, taken } = makeOverlay()
  overlay.handleInput('\x1b[B') // Down
  overlay.handleInput('\r')
  assert.deepEqual(taken, [1])
})
