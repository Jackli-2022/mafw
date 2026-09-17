import { test, expect } from 'bun:test'
import { mergeRemoteCommands } from '../src/renderer/mafw/components/command-merge'

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
