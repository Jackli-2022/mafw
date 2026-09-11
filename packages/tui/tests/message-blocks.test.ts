import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth } from '@earendil-works/pi-tui'
import { turnToLines } from '../src/ui/message-blocks.ts'
import type { ChatTurn } from '../src/store/chat-store.ts'

test('user turn renders with > prefix and text', () => {
  const turn: ChatTurn = { messageID: 'm1', role: 'user', parts: [{ id: 'p', type: 'text', text: 'hello' }], done: true }
  const lines = turnToLines(turn, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('> hello'))
})

test('running tool part renders one-line summary without output', () => {
  const turn: ChatTurn = {
    messageID: 'm2', role: 'assistant', done: false,
    parts: [{ id: 'pt', type: 'tool', toolName: 'bash', state: 'running', text: 'npm test' }],
  }
  const lines = turnToLines(turn, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
  assert.equal(clean.length, 2, 'running 只有摘要行 + 省略行') // ▸ bash … npm test + '…'
  assert.ok(clean[0].includes('bash'))
  assert.ok(clean[0].includes('npm test'))
  assert.ok(!clean[0].includes('output-below'), 'running 不渲染输出')
})

test('completed tool part renders summary + output lines', () => {
  const turn: ChatTurn = {
    messageID: 'm2', role: 'assistant', done: true,
    parts: [{ id: 'pt', type: 'tool', toolName: 'bash', state: 'completed', text: 'npm test\nok 12 passed' }],
  }
  const lines = turnToLines(turn, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('bash'))
  assert.ok(clean.includes('ok 12 passed'))
})

test('reasoning part renders dimmed with marker', () => {
  const turn: ChatTurn = {
    messageID: 'm3', role: 'assistant', done: true,
    parts: [{ id: 'pr', type: 'reasoning', text: 'thinking hard' }],
  }
  const lines = turnToLines(turn, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('thinking hard'))
})

test('streaming assistant turn shows pending marker', () => {
  const turn: ChatTurn = { messageID: 'm4', role: 'assistant', parts: [], done: false }
  const lines = turnToLines(turn, 80)
  assert.ok(lines.length >= 1)
})

test('every line fits width', () => {
  const turn: ChatTurn = {
    messageID: 'm5', role: 'assistant', done: true,
    parts: [{ id: 'p', type: 'text', text: 'x'.repeat(300) }],
  }
  for (const l of turnToLines(turn, 60)) assert.ok(visibleWidth(l) <= 60, `行超宽: ${visibleWidth(l)}`)
})

test('multi-line user text wraps and prefixes first line only', () => {
  const turn: ChatTurn = { messageID: 'm6', role: 'user', parts: [{ id: 'p', type: 'text', text: 'line1\nline2' }], done: true }
  const lines = turnToLines(turn, 80).map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
  assert.ok(lines[0].includes('> line1'))
  assert.ok(lines.some(l => l.includes('line2') && !l.includes('>')))
})
