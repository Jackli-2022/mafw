import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TranscriptSearchOverlay } from '../src/ui/transcript-search.ts'
import type { ChatTurn } from '../src/store/chat-store.ts'

function makeOverlay(turns: ChatTurn[]) {
  const jumps: number[] = []
  let closed = 0
  const overlay = new TranscriptSearchOverlay({
    getTurns: () => turns,
    onJump: (i) => jumps.push(i),
    onClose: () => { closed++ },
    requestRender: () => {},
  })
  return { overlay, jumps, get closed() { return closed } }
}

const TURNS: ChatTurn[] = [
  { messageID: 'm1', role: 'user', parts: [{ id: 'a', type: 'text', text: '帮我看下 auth 模块', state: 'completed' }], done: true },
  { messageID: 'm2', role: 'assistant', done: true, parts: [{ id: 'b', type: 'text', text: 'auth 模块在 src/auth', state: 'completed' }] },
  { messageID: 'm3', role: 'user', parts: [{ id: 'c', type: 'text', text: '再看看 payment', state: 'completed' }], done: true },
]

test('renders search input, matches with role marker, hint line', () => {
  const { overlay } = makeOverlay(TURNS)
  overlay.handleInput('a')
  overlay.handleInput('u')
  overlay.handleInput('t')
  overlay.handleInput('h')
  const clean = overlay.render(70).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('auth'), '命中片段')
  assert.ok(clean.includes('搜索'), '输入行')
  assert.ok(clean.includes('你'), '角色标记（user）')
  assert.ok(clean.includes('Enter 跳转'), '提示')
})

test('typing filters case-insensitively; backspace trims', () => {
  const { overlay } = makeOverlay(TURNS)
  for (const ch of 'AUTH') overlay.handleInput(ch)
  let clean = overlay.render(70).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('auth 模块在 src/auth'))
  assert.ok(!clean.includes('payment'), '未命中不显示')
  overlay.handleInput('\x7f') // Backspace → 'AUT'
  overlay.handleInput('\x7f')
  overlay.handleInput('\x7f')
  clean = overlay.render(70).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(!clean.includes('payment') || clean.includes('A'), '回退后重新过滤')
})

test('empty query lists nothing; no match shows placeholder', () => {
  const { overlay } = makeOverlay(TURNS)
  let clean = overlay.render(70).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(!clean.includes('payment'), '空查询无结果列表')
  for (const ch of 'zzz') overlay.handleInput(ch)
  clean = overlay.render(70).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('无匹配'))
})

test('arrows move selection; Enter jumps and closes; Esc closes without jump', () => {
  const h = makeOverlay(TURNS)
  for (const ch of 'auth') h.overlay.handleInput(ch)
  h.overlay.handleInput('\x1b[B') // down → 第二条命中
  h.overlay.handleInput('\r')
  assert.deepEqual(h.jumps, [1], '跳转到选中的 turn idx')
  assert.equal(h.closed, 1, '跳转后关闭')

  const e = makeOverlay(TURNS)
  for (const ch of 'auth') e.overlay.handleInput(ch)
  e.overlay.handleInput('\x1b')
  assert.deepEqual(e.jumps, [], 'Esc 不跳转')
  assert.equal(e.closed, 1)
})

test('selection marker moves with arrows', () => {
  const { overlay } = makeOverlay(TURNS)
  for (const ch of 'auth') overlay.handleInput(ch)
  const first = overlay.render(70).join('\n')
  overlay.handleInput('\x1b[B')
  const second = overlay.render(70).join('\n')
  assert.notEqual(first, second, '选择行变化')
})
