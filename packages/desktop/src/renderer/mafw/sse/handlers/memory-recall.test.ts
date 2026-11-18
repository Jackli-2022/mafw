import { describe, expect, test } from 'bun:test'
import { handleMemoryRecallEvent } from './memory-recall'

function receipt(updatedAt: string) {
  return { version: 1, status: 'inject', updatedAt, memories: [], t1: [], counts: { memories: 0, t1: 0 } } as any
}

describe('memory.recalled handler', () => {
  test('routes the event to the anchor store', () => {
    const calls: Array<[string, any]> = []
    const handled = handleMemoryRecallEvent(
      { type: 'memory.recalled', properties: { anchorKey: 'turn_a', receipt: receipt('2026-11-18T06:30:00.000Z') } },
      { getReceipt: () => undefined, upsertReceipt: (key, value) => calls.push([key, value]) },
    )
    expect(handled).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('turn_a')
  })

  test('ignores duplicate and older receipts', () => {
    const calls: any[] = []
    const deps = {
      getReceipt: () => receipt('2026-11-18T06:30:00.000Z'),
      upsertReceipt: (_key: string, value: any) => calls.push(value),
    }
    handleMemoryRecallEvent(
      { type: 'memory.recalled', properties: { anchorKey: 'turn_a', receipt: receipt('2026-11-18T06:30:00.000Z') } },
      deps,
    )
    handleMemoryRecallEvent(
      { type: 'memory.recalled', properties: { anchorKey: 'turn_a', receipt: receipt('2026-11-18T06:29:00.000Z') } },
      deps,
    )
    expect(calls).toHaveLength(0)
  })

  test('replaces a newer receipt', () => {
    const calls: any[] = []
    handleMemoryRecallEvent(
      { type: 'memory.recalled', properties: { anchorKey: 'turn_a', receipt: receipt('2026-11-18T06:31:00.000Z') } },
      {
        getReceipt: () => receipt('2026-11-18T06:30:00.000Z'),
        upsertReceipt: (_key: string, value: any) => calls.push(value),
      },
    )
    expect(calls).toHaveLength(1)
  })

  test('consumes malformed events without throwing', () => {
    const deps = { getReceipt: () => undefined, upsertReceipt: () => { throw new Error('should not be called') } }
    expect(handleMemoryRecallEvent({ type: 'memory.recalled' }, deps)).toBe(true)
    expect(handleMemoryRecallEvent({ type: 'other' }, deps)).toBe(false)
  })
})
