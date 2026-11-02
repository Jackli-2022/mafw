import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyPart, livePart } from '../src/store/chat-store.ts'

test('historyPart/livePart 的 tool 取 canonicalTool ?? tool（聚合不按别名碎片化）', () => {
  const h = historyPart({ id: 'p1', type: 'tool', callID: 'c1', tool: 'command_execution', canonicalTool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'x' } })
  assert.equal(h?.tool, 'bash')
  const l = livePart({ id: 'p2', type: 'tool', callID: 'c2', tool: 'ls', canonicalTool: 'list', state: { status: 'running', input: { path: '/x' } } })
  assert.equal(l?.tool, 'list')
  const plain = livePart({ id: 'p3', type: 'tool', callID: 'c3', tool: 'bash', state: { status: 'running', input: { command: 'x' } } })
  assert.equal(plain?.tool, 'bash') // 无 canonical 原样
  const noTool = historyPart({ id: 'p4', type: 'text', text: 'hi' })
  assert.equal(noTool?.type, 'text')
})
