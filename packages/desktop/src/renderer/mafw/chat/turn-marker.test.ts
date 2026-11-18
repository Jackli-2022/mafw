import { describe, expect, test } from 'bun:test'
import { composeTurnMarkerPart, extractTurnMarkerKey } from './turn-marker'

describe('turn marker', () => {
  test('composes a synthetic text part with a stable id', () => {
    const part = composeTurnMarkerPart(1000, 'abc')
    expect(part).toMatchObject({ type: 'text', id: 'turn_abc', synthetic: true })
    expect(part.text).toBe('[[turn]]')
  })

  test('extracts the marker id from parts', () => {
    expect(extractTurnMarkerKey([
      { id: 'p1', type: 'text', synthetic: false },
      { id: 'turn_abc', type: 'text', synthetic: true },
    ])).toBe('turn_abc')
  })

  test('ignores non-synthetic or non-turn parts', () => {
    expect(extractTurnMarkerKey([{ id: 'turn_abc', type: 'text', synthetic: false }])).toBeNull()
    expect(extractTurnMarkerKey([{ id: 'prt_1', type: 'text', synthetic: true }])).toBeNull()
  })
})
