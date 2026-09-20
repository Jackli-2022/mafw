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
    showQueueManager: async () => { calls.push('queue') },
    showModelPicker: async () => { calls.push('model') },
    compact: async () => { calls.push('compact'); return null },
    undo: async () => { calls.push('undo'); return null },
    redo: async () => { calls.push('redo'); return null },
    openExternalEditor: async () => { calls.push('editor') },
    cycleVerbosity: () => { calls.push('verbose'); return 'off' },
    toggleFocus: () => { calls.push('focus'); return true },
    showDiff: async (scope: string) => { calls.push(`diff:${scope}`); return null },
    rename: async (args: string) => { calls.push(`rename:${args}`); return null },
    fork: async () => { calls.push('fork'); return null },
    showStatusRecap: () => { calls.push('status') },
    waitwhat: async () => { calls.push('waitwhat'); return null },
    runGatewayCommand: async (name: string, args: string) => { calls.push(`gw:${name}:${args}`); return null },
    gatewayCommands: () => [],
    quitApp: () => { calls.push('exit') },
    exportChat: async () => { calls.push('export'); return null },
    copyReply: (n: number) => { calls.push(`copy:${n}`); return 'ok' },
    showUsage: async () => { calls.push('usage'); return null },
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

test('queue command and /q alias open the queue manager', async () => {
  const a = harness()
  assert.equal(await a.handler('queue', ''), null)
  const b = harness()
  assert.equal(await b.handler('q', ''), null)
  assert.deepEqual(b.calls, ['queue'])
})

test('verbose/focus/diff dispatch and return status messages', async () => {
  const h = harness()
  const v = await h.handler('verbose', '')
  assert.ok(v!.includes('折叠'))
  const f = await h.handler('focus', '')
  assert.ok(f!.includes('开启'))
  assert.equal(await h.handler('diff', 'staged'), null)
  assert.deepEqual(h.calls, ['verbose', 'focus', 'diff:staged'])
})

test('rename/fork/status dispatch to their deps', async () => {
  const h = harness()
  await h.handler('rename', '我的实验')
  await h.handler('fork', '')
  await h.handler('status', '')
  assert.deepEqual(h.calls, ['rename:我的实验', 'fork', 'status'])
})

test('waitwhat dispatches to its dep and surfaces error messages', async () => {
  const h = harness()
  assert.equal(await h.handler('waitwhat', ''), null)
  assert.deepEqual(h.calls, ['waitwhat'])
  const e = harness({ waitwhat: async () => 'waitwhat 失败: gateway down' })
  assert.equal(await e.handler('waitwhat', ''), 'waitwhat 失败: gateway down')
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

test('unknown-to-local command falls back to gateway dispatch', async () => {
  const h = harness({
    gatewayCommands: () => [{ name: 'goal', aliases: ['g'], destructive: false }],
  })
  const r = await h.handler('goal', '做个登录页')
  assert.equal(r, null)
  assert.deepEqual(h.calls, ['gw:goal:做个登录页'])
})

test('gateway alias resolves to canonical name for dispatch', async () => {
  const h = harness({
    gatewayCommands: () => [{ name: 'goal', aliases: ['g'], destructive: false }],
  })
  await h.handler('g', 'x')
  assert.deepEqual(h.calls, ['gw:goal:x'])
})

test('exit triggers quit callback (alias quit)', async () => {
  const h = harness()
  await h.handler('exit', '')
  await h.handler('quit', '')
  assert.deepEqual(h.calls, ['exit', 'exit'])
})

test('usage/copy/export dispatch to their deps', async () => {
  const h = harness()
  assert.equal(await h.handler('usage', ''), null)
  assert.equal(await h.handler('copy', '2'), 'ok')
  assert.equal(await h.handler('export', ''), null)
  assert.deepEqual(h.calls, ['usage', 'copy:2', 'export'])
})

test('SLASH_COMMANDS covers the full command surface', () => {
  const names = SLASH_COMMANDS.map((c) => c.name).sort()
  assert.deepEqual(names, ['agent', 'btw', 'build', 'compact', 'copy', 'diff', 'editor', 'exit', 'export', 'focus', 'fork', 'help', 'model', 'new', 'older', 'permissions', 'plan', 'queue', 'redo', 'rename', 'sessions', 'status', 'undo', 'usage', 'verbose', 'waitwhat'])
})
