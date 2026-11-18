import { describe, expect, test } from 'bun:test'
import { extractTurnMarkerKey } from '../../../src/hooks/turn-marker'

describe('host turn marker', () => {
  test('extracts the same marker the desktop composes', () => {
    expect(extractTurnMarkerKey([
      { id: 'p1', type: 'text', synthetic: false },
      { id: 'turn_abc', type: 'text', synthetic: true },
    ])).toBe('turn_abc')
  })

  test('ignores non-synthetic and non-turn parts', () => {
    expect(extractTurnMarkerKey([{ id: 'turn_abc', type: 'text', synthetic: false }])).toBeNull()
    expect(extractTurnMarkerKey([{ id: 'prt_1', type: 'text', synthetic: true }])).toBeNull()
    expect(extractTurnMarkerKey(undefined)).toBeNull()
  })
})
