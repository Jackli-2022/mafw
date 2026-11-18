import { describe, expect, test } from 'bun:test'
import { extractTurnMarkerKey, stripTurnMarker } from '../../../src/hooks/turn-marker'

describe('host turn marker', () => {
  test('extracts the same marker the desktop composes', () => {
    expect(extractTurnMarkerKey([
      { id: 'p1', type: 'text', synthetic: false },
      { id: 'turn_abc', type: 'text', synthetic: true },
    ])).toBe('turn_abc')
  })

  test('extracts the marker from persisted text', () => {
    expect(extractTurnMarkerKey([
      { id: 'msg-p0', type: 'text', text: 'hello\n[[turn:turn_abc]]' },
    ])).toBe('turn_abc')
  })

  test('ignores non-synthetic and non-turn parts', () => {
    expect(extractTurnMarkerKey([{ id: 'turn_abc', type: 'text', synthetic: false }])).toBeNull()
    expect(extractTurnMarkerKey([{ id: 'prt_1', type: 'text', synthetic: true }])).toBeNull()
    expect(extractTurnMarkerKey(undefined)).toBeNull()
  })

  test('strips the marker before the query is built', () => {
    expect(stripTurnMarker('hello\n[[turn:turn_abc]]')).toBe('hello\n')
  })
})
