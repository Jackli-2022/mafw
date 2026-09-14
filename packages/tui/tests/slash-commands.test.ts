import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSlashHandler, SLASH_COMMANDS } from '../src/ui/slash-commands.ts'

function harness(over: Partial<Record<string, any>> = {}) {
  const calls: string[] = []
  const deps = {
    loadOlder: async () => { calls.push('older') },
    toggleHelp: () => { calls.push('help') },
    rotateTopic: async () => { calls.push('new'); return null },
    btw: async (args: string) => { calls.push(`btw:${args}`); return null },
    showSessionPicker: async () => { calls.push('sessions') },
    showModelPicker: async () => { calls.push('model') },
    compact: async () => { calls.push('compact'); return null },
    undo: async () => { calls.push('undo'); return null },
    redo: async () => { calls.push('redo'); return null },
    openExternalEditor: async () => { calls.push('editor') },
    ...over,
  }
  return { calls, deps, handler: createSlashHandler(deps as any) }
}

test('existing commands keep working: help/older/new/btw', async () => {
  const h = harness()
  assert.equal(await h.handler('help', ''), null)
  assert.equal(await h.handler('older', ''), null)
  assert.equal(await h.handler('new', ''), null)
  assert.equal(await h.handler('btw', 'side question'), null)
  assert.deepEqual(h.calls, ['help', 'older', 'new', 'btw:side question'])
})

test('sessions command and aliases open the session picker', async () => {
  for (const cmd of ['sessions', 'resume', 'switch']) {
    const h = harness()
    assert.equal(await h.handler(cmd, ''), null)
    assert.deepEqual(h.calls, ['sessions'], `${cmd} 别名生效`)
  }
})

test('model/compact/undo/redo/editor dispatch to their deps', async () => {
  const h = harness()
  await h.handler('model', '')
  await h.handler('compact', '')
  await h.handler('undo', '')
  await h.handler('redo', '')
  await h.handler('editor', '')
  assert.deepEqual(h.calls, ['model', 'compact', 'undo', 'redo', 'editor'])
})

test('compact/undo/redo surface dep error messages', async () => {
  const h = harness({ compact: async () => 'compact 失败: gateway down' })
  assert.equal(await h.handler('compact', ''), 'compact 失败: gateway down')
})

test('unknown command lists available commands', async () => {
  const h = harness()
  const r = await h.handler('nope', '')
  assert.ok(r!.includes('nope'))
  for (const c of SLASH_COMMANDS) assert.ok(r!.includes(`/${c.name}`))
})

test('SLASH_COMMANDS covers the full command surface', () => {
  const names = SLASH_COMMANDS.map((c) => c.name).sort()
  assert.deepEqual(names, ['btw', 'compact', 'editor', 'help', 'model', 'new', 'older', 'redo', 'sessions', 'undo'])
})
