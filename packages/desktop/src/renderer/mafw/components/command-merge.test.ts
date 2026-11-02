import { describe, expect, test } from 'bun:test'
import { mergeDiscoveryCommands, mergeRemoteCommands } from './command-merge'

const remote = [
  { name: 'ship', description: 'ship it', category: 'custom', kind: 'custom' as const },
]

describe('mergeDiscoveryCommands (custom picker dedupe)', () => {
  test('skips MAFW-owned custom commands that already come from mafwCommands.list', () => {
    const { names } = mergeRemoteCommands(remote)
    const out = mergeDiscoveryCommands(
      [
        { name: 'ship', source: 'custom' },
        { name: 'review', source: 'runtime' },
      ],
      names,
    )
    expect(out).toEqual([{ name: 'review', source: 'command' }])
  })

  test('skips source=custom even when the remote list is empty (restart/offline)', () => {
    expect(mergeDiscoveryCommands([{ name: 'ship', source: 'custom' }], new Set())).toEqual([])
  })

  test('dedupes by case-insensitive name against reserved and seen', () => {
    const out = mergeDiscoveryCommands(
      [
        { name: 'Review', source: 'runtime' },
        { name: 'review', source: 'runtime' },
        { name: 'SHIP', source: 'runtime' },
      ],
      new Set(['Ship']),
    )
    expect(out).toEqual([{ name: 'Review', source: 'command' }])
  })

  test('tolerates malformed entries', () => {
    expect(mergeDiscoveryCommands([null, undefined, {}, { name: '' }])).toEqual([])
    expect(mergeDiscoveryCommands(undefined)).toEqual([])
  })
})
