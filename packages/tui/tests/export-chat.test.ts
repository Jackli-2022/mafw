import { test } from 'node:test'
import assert from 'node:assert/strict'
import { turnsToMarkdown, exportChat } from '../src/ui/export-chat.ts'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

test('turnsToMarkdown renders user/assistant with text parts', () => {
  const md = turnsToMarkdown([
    { messageID: 'm1', role: 'user', done: true, parts: [{ id: '1', type: 'text', text: '你好' }] },
    { messageID: 'm2', role: 'assistant', done: true, parts: [{ id: '2', type: 'text', text: '回答' }, { id: '3', type: 'tool', name: 'bash' } as any] },
  ] as any)
  assert.ok(md.includes('## User'))
  assert.ok(md.includes('你好'))
  assert.ok(md.includes('## Assistant'))
  assert.ok(md.includes('回答'))
  assert.ok(!md.includes('bash'))  // 工具块不导出
})

test('queued/local turns skipped', () => {
  const md = turnsToMarkdown([
    { messageID: 'queued-1', role: 'user', done: false, queued: true, parts: [{ id: '1', type: 'text', text: '排队' }] },
    { messageID: 'local-2', role: 'user', done: true, parts: [{ id: '2', type: 'text', text: '本地块' }] },
  ] as any)
  assert.equal(md.includes('排队'), false)
  assert.equal(md.includes('本地块'), false)
})

test('exportChat writes file and returns path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-export-'))
  const p = await exportChat([
    { messageID: 'm1', role: 'user', done: true, parts: [{ id: '1', type: 'text', text: 'x' }] },
  ] as any, dir)
  assert.ok(p.startsWith(dir))
  assert.ok(fs.readFileSync(p, 'utf-8').includes('x'))
  fs.rmSync(dir, { recursive: true, force: true })
})
