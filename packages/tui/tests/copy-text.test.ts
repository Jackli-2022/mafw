import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastAssistantText, copyToClipboard } from '../src/ui/copy-text.ts'

test('lastAssistantText picks Nth latest assistant text', () => {
  const turns = [
    { messageID: 'u1', role: 'user', done: true, parts: [{ type: 'text', text: 'q1' }] },
    { messageID: 'a1', role: 'assistant', done: true, parts: [{ type: 'text', text: 'first' }] },
    { messageID: 'a2', role: 'assistant', done: true, parts: [{ type: 'text', text: 'second' }] },
  ] as any
  assert.equal(lastAssistantText(turns, 1), 'second')
  assert.equal(lastAssistantText(turns, 2), 'first')
  assert.equal(lastAssistantText(turns, 3), null)
  assert.equal(lastAssistantText([], 1), null)
})

test('copyToClipboard emits OSC52 with base64 payload', () => {
  const written: string[] = []
  copyToClipboard('hi', (s) => written.push(s))
  assert.equal(written.length, 1)
  assert.ok(written[0].startsWith('\x1b]52;c;'))
  assert.ok(written[0].includes(Buffer.from('hi').toString('base64')))
  assert.ok(written[0].endsWith('\x07'))
})
