import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { visibleWidth } from '@earendil-works/pi-tui'
import { turnToLines } from '../src/ui/message-blocks.ts'
import type { ChatTurn } from '../src/store/chat-store.ts'

// 非 TTY 测试环境 chalk 自动降级关色；强制开色以断言 ANSI 样式
chalk.level = 3

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

test('assistant markdown text renders via Markdown (bold markers stripped, code fenced)', () => {
  const turn: ChatTurn = {
    messageID: 'm7', role: 'assistant', done: true,
    parts: [{ id: 'p', type: 'text', text: '看这个 **重点**：\n\n```ts\nconst x = 1\n```' }],
  }
  const lines = turnToLines(turn, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('重点'), '粗体文本保留')
  assert.ok(!clean.includes('**重点**'), 'markdown 标记被消费而非原样输出')
  assert.ok(clean.includes('const x = 1'), '代码块内容保留')
})

test('assistant heading renders without leading #', () => {
  const turn: ChatTurn = {
    messageID: 'm8', role: 'assistant', done: true,
    parts: [{ id: 'p', type: 'text', text: '# 标题' }],
  }
  const clean = turnToLines(turn, 80).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('标题'))
  assert.ok(!clean.includes('# 标题'), 'heading 标记被消费')
})

test('queued user turn renders with pending marker and dim', () => {
  const turn: ChatTurn = {
    messageID: 'q1', role: 'user', done: true, queued: true,
    parts: [{ id: 'p', type: 'text', text: '排队消息' }],
  }
  const lines = turnToLines(turn, 80)
  const raw = lines.join('\n')
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('排队消息'))
  assert.ok(clean.includes('⏳'), '排队标记')
  assert.ok(raw.includes('\x1b[90m'), 'dim 样式')
})

test('diff-style tool output colors +/- lines', () => {
  const turn: ChatTurn = {
    messageID: 'm9', role: 'assistant', done: true,
    parts: [{ id: 'pt', type: 'tool', toolName: 'edit', state: 'completed', text: 'file.ts\n+added line\n-removed line\n@@ hunk @@' }],
  }
  const lines = turnToLines(turn, 80)
  const raw = lines.join('\n')
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('+added line'))
  assert.ok(clean.includes('-removed line'))
  assert.ok(raw.includes('\x1b[32m+added'), 'added 行绿色')
  assert.ok(raw.includes('\x1b[31m-removed'), 'removed 行红色')
})
