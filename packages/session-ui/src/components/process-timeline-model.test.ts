import { describe, expect, test } from 'bun:test'
import { formatDuration, processSummary, defaultSegmentOpen } from './process-timeline-model'
import type { TurnEntry } from './turn-transcript'

describe('formatDuration', () => {
  test('formats seconds and minutes', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(999)).toBe('1 秒')
    expect(formatDuration(3000)).toBe('3 秒')
    expect(formatDuration(65_000)).toBe('1 分 05 秒')
  })
})

describe('processSummary', () => {
  test('counts steps and derives the live duration window', () => {
    const segment: Extract<TurnEntry, { type: 'segment' }> = {
      type: 'segment',
      key: 'seg',
      process: [
        { type: 'thinking', key: 'r', parts: [{ id: 'r', type: 'reasoning' as const, text: 'x', time: { start: 100, end: 4000 } }] },
        { type: 'tool', key: 't', part: { id: 't', type: 'tool' as const, tool: 'read', callID: 'c', state: { status: 'completed', input: {}, content: [], time: { start: 4000, end: 6000 } } } as any, tool: 'read' },
      ],
      output: [],
    }
    expect(processSummary(segment)).toEqual({ tools: 1, thinking: 1, durationMs: 5900 })
  })
})

describe('defaultSegmentOpen', () => {
  test('opens only the active segment while working', () => {
    expect(defaultSegmentOpen(true, true)).toBe(true)
    expect(defaultSegmentOpen(true, false)).toBe(false)
    expect(defaultSegmentOpen(false, true)).toBe(false)
  })
})
