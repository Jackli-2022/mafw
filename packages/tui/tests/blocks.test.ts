import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { visibleWidth } from '@earendil-works/pi-tui'
import {
  UserTextBlock, AssistantMarkdownBlock, ReasoningBlock, ToolBlock,
  type DisplaySettings,
} from '../src/ui/blocks.ts'
import type { ChatPart } from '../src/store/chat-store.ts'

chalk.level = 3

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

function makeSettings(over: Partial<DisplaySettings> = {}): DisplaySettings {
  return { focus: false, toolVerbosity: 'all', ...over }
}

function toolPart(over: Partial<ChatPart> = {}): ChatPart {
  return {
    id: 'pt', type: 'tool', toolName: 'bash', state: 'completed',
    text: 'npm test\nok 12 passed\n+added line', ...over,
  } as ChatPart
}

test('user text block renders > prefix on first line only', () => {
  const b = new UserTextBlock({ id: 'p', type: 'text', text: 'line1\nline2', state: 'completed' })
  const clean = b.render(80).map(strip)
  assert.ok(clean[0].startsWith('> line1'))
  assert.ok(clean.some(l => l.trim() === 'line2'))
})

test('queued user block renders dim with ⏳ marker', () => {
  const b = new UserTextBlock({ id: 'p', type: 'text', text: '排队中', state: 'completed' }, true)
  const raw = b.render(80).join('\n')
  const clean = strip(raw)
  assert.ok(clean.includes('⏳'))
  assert.ok(raw.includes('\x1b[90m'), 'dim 样式')
})

test('assistant markdown block consumes markdown markers', () => {
  const b = new AssistantMarkdownBlock({ id: 'p', type: 'text', text: '看 **重点**', state: 'completed' })
  const clean = b.render(80).map(strip).join('\n')
  assert.ok(clean.includes('重点'))
  assert.ok(!clean.includes('**重点**'))
})

test('reasoning block renders dim marker lines', () => {
  const b = new ReasoningBlock({ id: 'p', type: 'reasoning', text: 'thinking', state: 'completed' })
  const raw = b.render(80).join('\n')
  assert.ok(strip(raw).includes('thinking'))
  assert.ok(raw.includes('\x1b[90m'))
})

test('tool block: collapsed renders one summary line without output', () => {
  const settings = makeSettings({ toolVerbosity: 'off' })
  const b = new ToolBlock(toolPart(), settings, () => {})
  const lines = b.render(80)
  const clean = lines.map(strip)
  assert.equal(lines.length, 1, '折叠=只有摘要行')
  assert.ok(clean[0].includes('bash'))
  assert.ok(clean[0].includes('npm test'))
  assert.ok(!clean.join('\n').includes('ok 12 passed'), '折叠不显示输出')
})

test('tool block: expanded renders summary + output with diff coloring', () => {
  const settings = makeSettings({ toolVerbosity: 'all' })
  const b = new ToolBlock(toolPart(), settings, () => {})
  const raw = b.render(80).join('\n')
  const clean = strip(raw)
  assert.ok(clean.includes('ok 12 passed'))
  assert.ok(clean.includes('+added line'))
  assert.ok(raw.includes('\x1b[32m+added'), '+ 行绿色')
})

test('tool block click toggles expanded/collapsed', () => {
  const settings = makeSettings({ toolVerbosity: 'off' })
  let renders = 0
  const b = new ToolBlock(toolPart(), settings, () => { renders++ })
  assert.equal(b.render(80).length, 1, '默认折叠')
  assert.equal(b.handleMouseClick(0, 0), true, '点击消费')
  assert.ok(b.render(80).length > 1, '点击后展开')
  assert.ok(renders > 0, '触发重渲染')
  b.handleMouseClick(0, 0)
  assert.equal(b.render(80).length, 1, '再点折叠')
})

test('tool block update(part) re-renders streaming snapshot', () => {
  const settings = makeSettings()
  const b = new ToolBlock(toolPart({ state: 'running', text: 'npm test' }), settings, () => {})
  assert.equal(b.render(80).length, 1, 'running 摘要行')
  b.update(toolPart()) // completed + output
  assert.ok(b.render(80).length > 1, '完成后展开输出')
})

test('focus mode: tool block renders single dim hidden line', () => {
  const settings = makeSettings({ focus: true })
  const b = new ToolBlock(toolPart(), settings, () => {})
  const lines = b.render(80)
  assert.equal(lines.length, 1)
  const clean = strip(lines[0])
  assert.ok(clean.includes('⋯'), '隐藏标记')
  assert.ok(clean.includes('bash'))
})

test('all block renders fit width', () => {
  const settings = makeSettings()
  const blocks = [
    new UserTextBlock({ id: 'a', type: 'text', text: 'x'.repeat(200), state: 'completed' }),
    new AssistantMarkdownBlock({ id: 'b', type: 'text', text: 'y'.repeat(200), state: 'completed' }),
    new ToolBlock(toolPart({ text: `cmd\n${'z'.repeat(200)}` }), settings, () => {}),
  ]
  for (const b of blocks) {
    for (const l of b.render(60)) assert.ok(visibleWidth(l) <= 60)
  }
})
