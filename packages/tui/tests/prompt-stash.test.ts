import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PromptStash } from '../src/ui/prompt-stash.ts'

test('stash is a LIFO stack with peek count', () => {
  const s = new PromptStash()
  assert.equal(s.size, 0)
  assert.equal(s.pop(), null, '空栈 pop 返回 null')
  s.push('draft one')
  s.push('draft two')
  assert.equal(s.size, 2)
  assert.equal(s.pop(), 'draft two', 'LIFO')
  assert.equal(s.pop(), 'draft one')
  assert.equal(s.size, 0)
})

test('empty-text push is ignored', () => {
  const s = new PromptStash()
  s.push('   ')
  assert.equal(s.size, 0)
})

test('multi-line drafts round-trip exactly', () => {
  const s = new PromptStash()
  s.push('line1\nline2\n')
  assert.equal(s.pop(), 'line1\nline2\n')
})
