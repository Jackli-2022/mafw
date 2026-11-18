import { describe, expect, test } from 'bun:test'
import { composeTurnMarkerPart, extractTurnMarkerKey, stripTurnMarker } from './turn-marker'

describe('turn marker', () => {
  test('composes a synthetic text part carrying the key in its text', () => {
    const part = composeTurnMarkerPart(1000, 'abc')
    expect(part).toMatchObject({ type: 'text', id: 'turn_abc', synthetic: true })
    expect(part.text).toBe('[[turn:turn_abc]]')
  })

  test('extracts the marker id from parts', () => {
    expect(extractTurnMarkerKey([
      { id: 'p1', type: 'text', synthetic: false },
      { id: 'turn_abc', type: 'text', synthetic: true },
    ])).toBe('turn_abc')
  })

  test('extracts the marker from persisted text when the part id was lost', () => {
    expect(extractTurnMarkerKey([
      { id: 'msg-p0', type: 'text', text: '<facts>noise</facts>\n\nhello\n[[turn:turn_abc]]' },
    ])).toBe('turn_abc')
  })

  test('ignores non-synthetic or non-turn parts', () => {
    expect(extractTurnMarkerKey([{ id: 'turn_abc', type: 'text', synthetic: false }])).toBeNull()
    expect(extractTurnMarkerKey([{ id: 'prt_1', type: 'text', synthetic: true }])).toBeNull()
  })

  test('strips the marker from display text', () => {
    expect(stripTurnMarker('hello\n[[turn:turn_abc]]')).toBe('hello\n')
    expect(stripTurnMarker('hello')).toBe('hello')
  })
})
