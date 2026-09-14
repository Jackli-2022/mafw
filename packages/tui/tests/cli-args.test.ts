import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/cli.ts'

test('parseArgs defaults to bm25 without session', () => {
  assert.deepEqual(parseArgs([]), { retriever: 'bm25' })
  assert.deepEqual(parseArgs(['--hybrid']), { retriever: 'hybrid' })
})

test('parseArgs reads --session <id>', () => {
  assert.deepEqual(parseArgs(['--session', 'ses_abc123']), { retriever: 'bm25', sessionID: 'ses_abc123' })
  assert.deepEqual(parseArgs(['--hybrid', '--session', 'ses_x']), { retriever: 'hybrid', sessionID: 'ses_x' })
  assert.deepEqual(parseArgs(['--session']), { retriever: 'bm25' }, '缺值时忽略')
})
