import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSlash } from '../src/ui/chat-tab.ts'

test('parseSlash splits command and args', () => {
  assert.deepEqual(parseSlash('/btw 这是什么'), { cmd: 'btw', args: '这是什么' })
  assert.deepEqual(parseSlash('/new'), { cmd: 'new', args: '' })
  assert.equal(parseSlash('plain text'), null)
  assert.equal(parseSlash('/'), null)
})
