import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyPart, livePart } from '../src/store/chat-store.ts'

test('historyPart/livePart 的 toolName 取 canonicalTool ?? tool（聚合不按别名碎片化）', () => {
  const h = historyPart({ id: 'p1', type: 'tool', tool: 'command_execution', canonicalTool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'x' } })
  assert.equal(h?.toolName, 'bash')
  const l = livePart({ id: 'p2', type: 'tool', tool: 'ls', canonicalTool: 'list', state: { status: 'running', input: { path: '/x' } } })
  assert.equal(l?.toolName, 'list')
  const plain = livePart({ id: 'p3', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'x' } } })
  assert.equal(plain?.toolName, 'bash') // 无 canonical 原样
  const noTool = historyPart({ id: 'p4', type: 'text', text: 'hi' })
  assert.equal(noTool?.type, 'text')
})
