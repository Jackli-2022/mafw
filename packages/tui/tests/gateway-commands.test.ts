import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCommands, type RemoteCommand } from '../src/ui/gateway-commands.ts'
import { COMMAND_REGISTRY, resolveCommand } from '../src/ui/command-registry.ts'

test('mergeCommands appends non-colliding remote commands', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'goal', description: '提交 Goal', category: 'goals', kind: 'builtin', argumentHint: '<目标>' },
  ])
  assert.ok(merged.find((c) => c.name === 'goal'))
  assert.equal(merged.find((c) => c.name === 'goal')?.argumentHint, '<目标>')
})

test('local wins on name collision (status)', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'status', description: 'MAFW 状态', category: 'goals', kind: 'builtin' },
  ])
  assert.equal(merged.filter((c) => c.name === 'status').length, 1)
  assert.equal(merged.find((c) => c.name === 'status')?.description, COMMAND_REGISTRY.find((c) => c.name === 'status')?.description)
})

test('local wins on alias collision (remote new-topic alias new vs local new)', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'new-topic', aliases: ['new'], description: '新话题', category: 'session', kind: 'builtin' },
  ])
  assert.equal(merged.find((c) => c.name === 'new-topic'), undefined)
})

test('custom commands land in 自定义 category with gateway flag', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'git:commit', description: '提交', category: 'custom', kind: 'custom' },
  ])
  const c = merged.find((x) => x.name === 'git:commit')
  assert.equal(c?.category, '自定义')
  assert.equal(c?.gateway, true)
})

test('mergeCommands preserves remote aliases when no collision', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'merge-memory', aliases: ['mm'], description: '融合', category: 'memory', kind: 'builtin' },
  ])
  const c = merged.find((x) => x.name === 'merge-memory')
  assert.deepEqual(c?.aliases, ['mm'])
})

test('resolveCommand still local-only (unchanged)', () => {
  assert.equal(resolveCommand('goal'), null)
})
