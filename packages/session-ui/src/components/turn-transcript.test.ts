import { describe, expect, test } from 'bun:test'
import { splitTurn, type TurnEntry } from './turn-transcript'

const text = (id: string, value: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', text: value, ...extra })
const think = (id: string, value: string) => ({ id, type: 'reasoning', text: value })
const tool = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'tool', tool: name, canonicalTool: name, callID: `call_${id}`,
  state: { status: 'completed', input: {}, content: [] }, ...extra,
})

function segments(entries: TurnEntry[]) {
  return entries.filter((entry): entry is Extract<TurnEntry, { type: 'segment' }> => entry.type === 'segment')
}

describe('splitTurn', () => {
  test('splits at outputs: thinking → tool → output → thinking → tool → output', () => {
    const entries = splitTurn([
      think('r1', 'first thought'),
      tool('t1', 'read'),
      text('x1', 'first output'),
      think('r2', 'second thought'),
      tool('t2', 'grep'),
      text('x2', 'final output'),
    ], { showReasoning: true })

    const segs = segments(entries)
    expect(segs).toHaveLength(2)
    expect(segs[0].process.map((step) => step.type)).toEqual(['thinking', 'tool'])
    expect(segs[0].output.map((part) => part.id)).toEqual(['x1'])
    expect(segs[1].process.map((step) => step.type)).toEqual(['thinking', 'tool'])
    expect(segs[1].output.map((part) => part.id)).toEqual(['x2'])
  })

  test('returns an output-only segment when there is no process', () => {
    const entries = splitTurn([text('x1', 'hello')], { showReasoning: true })
    expect(entries).toHaveLength(1)
    expect(segments(entries)[0].process).toEqual([])
    expect(segments(entries)[0].output[0].id).toBe('x1')
  })

  test('keeps a process-only segment when there is no output', () => {
    const entries = splitTurn([think('r1', 'thinking'), tool('t1', 'read')], { showReasoning: true })
    expect(segments(entries)).toHaveLength(1)
    expect(segments(entries)[0].output).toEqual([])
  })

  test('starts a new segment when a timeline tool follows output', () => {
    const entries = splitTurn([
      text('x1', 'first'),
      tool('t1', 'read'),
      text('x2', 'second'),
    ], { showReasoning: true })
    const segs = segments(entries)
    expect(segs).toHaveLength(2)
    expect(segs[0].output[0].id).toBe('x1')
    expect(segs[1].process[0].type).toBe('tool')
    expect(segs[1].output[0].id).toBe('x2')
  })

  test('flushes a segment around a write/action card', () => {
    const entries = splitTurn([
      tool('t1', 'read'),
      text('x1', 'before'),
      tool('e1', 'edit'),
      tool('t2', 'grep'),
      text('x2', 'after'),
    ], { showReasoning: true })
    expect(entries.map((entry) => entry.type)).toEqual(['segment', 'card', 'segment'])
    const card = entries[1] as Extract<TurnEntry, { type: 'card' }>
    expect(card.part.id).toBe('e1')
  })

  test('treats data/file parts as top-level entries', () => {
    const entries = splitTurn([
      text('x1', 'hello'),
      { id: 'd1', type: 'data-goal', data: {} } as any,
      text('x2', 'world'),
    ], { showReasoning: true })
    expect(entries.map((entry) => entry.type)).toEqual(['segment', 'data', 'segment'])
  })

  test('merges adjacent reasoning parts into one thinking step', () => {
    const entries = splitTurn([think('r1', 'a'), think('r2', 'b'), tool('t1', 'read')], { showReasoning: true })
    const step = segments(entries)[0].process[0]
    expect(step.type).toBe('thinking')
    if (step.type === 'thinking') expect(step.parts.map((part) => part.id)).toEqual(['r1', 'r2'])
  })

  test('drops reasoning when showReasoning is false', () => {
    const entries = splitTurn([think('r1', 'hidden'), text('x1', 'shown')], { showReasoning: false })
    expect(segments(entries)).toHaveLength(1)
    expect(segments(entries)[0].process).toEqual([])
    expect(segments(entries)[0].output[0].id).toBe('x1')
  })

  test('ignores synthetic text parts', () => {
    const entries = splitTurn([text('x1', 'shown'), text('s1', 'hidden', { synthetic: true })], { showReasoning: true })
    expect(segments(entries)[0].output.map((part) => part.id)).toEqual(['x1'])
  })
})
