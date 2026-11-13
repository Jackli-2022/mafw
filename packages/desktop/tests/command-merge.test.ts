import { test, expect } from 'bun:test'
import { mergeDiscoveryCommands, mergeRemoteCommands } from '../src/renderer/mafw/components/command-merge'

test('remote defs map to mafw CommandItems with trigger and hint', () => {
  const { items, names } = mergeRemoteCommands([
    { name: 'btw', description: '支线问答', argumentHint: '<问题>', category: 'session', kind: 'builtin' },
    { name: 'git:commit', description: '提交', category: 'custom', kind: 'custom' },
  ])
  expect(items[0]).toMatchObject({ id: 'mafw-btw', trigger: '/btw', group: 'mafw', source: 'builtin' })
  expect(items[0].description).toContain('<问题>')
  expect(items[1].group).toBe('mafw')
  expect(names.has('btw')).toBe(true)
  expect(names.has('git:commit')).toBe(true)
})

test('aliases registered in names for matchCommand', () => {
  const { names } = mergeRemoteCommands([
    { name: 'new-topic', aliases: ['nt'], description: 'x', category: 'session', kind: 'builtin' },
  ])
  expect(names.has('nt')).toBe(true)
})

test('empty remote → empty', () => {
  const { items, names } = mergeRemoteCommands([])
  expect(items).toEqual([])
  expect(names.size).toBe(0)
})

test('runtime command metadata survives the merge', () => {
  const out = mergeDiscoveryCommands([
    {
      name: 'review',
      source: 'runtime',
      description: 'review changes',
      argumentHint: '[target]',
      agent: 'plan',
      model: { id: 'm1', providerID: 'p1', variant: 'high' },
      subtask: true,
    },
  ])
  expect(out[0]).toMatchObject({
    name: 'review',
    source: 'command',
    description: 'review changes',
    argumentHint: '[target]',
    agent: 'plan',
    model: { id: 'm1', providerID: 'p1', variant: 'high' },
    subtask: true,
  })
})

test('mafw and custom entries are still filtered out', () => {
  const out = mergeDiscoveryCommands([
    { name: 'goal', source: 'mafw' },
    { name: 'git:commit', source: 'custom' },
    { name: 'review', source: 'runtime' },
  ])
  expect(out.map((c) => c.name)).toEqual(['review'])
})
