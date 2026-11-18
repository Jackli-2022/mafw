import { describe, expect, test } from 'bun:test'
import { createMemoryReceiptStore } from './memory-receipt-store'

function receipt(updatedAt: string) {
  return { version: 1, status: 'inject', updatedAt, memories: [], t1: [], counts: { memories: 0, t1: 0 } } as any
}

describe('memory receipt store', () => {
  test('upserts and reads by session + anchor', () => {
    const store = createMemoryReceiptStore()
    store.upsertReceipt('s1', 'turn_a', receipt('2026-11-18T06:30:00.000Z'))
    expect(store.forAnchor('s1', 'turn_a')?.updatedAt).toBe('2026-11-18T06:30:00.000Z')
    expect(store.forAnchor('s2', 'turn_a')).toBeUndefined()
  })

  test('hydrates history and keeps the newer receipt', () => {
    const store = createMemoryReceiptStore()
    store.hydrate('s1', [
      { anchorKey: 'turn_a', receipt: receipt('2026-11-18T06:30:00.000Z') },
      { anchorKey: 'turn_b', receipt: receipt('2026-11-18T06:31:00.000Z') },
    ])
    expect(store.forAnchor('s1', 'turn_a')?.updatedAt).toBe('2026-11-18T06:30:00.000Z')
    store.upsertReceipt('s1', 'turn_a', receipt('2026-11-18T06:29:00.000Z'))
    expect(store.forAnchor('s1', 'turn_a')?.updatedAt).toBe('2026-11-18T06:30:00.000Z')
  })

  test('clears a session without touching another', () => {
    const store = createMemoryReceiptStore()
    store.upsertReceipt('s1', 'turn_a', receipt('2026-11-18T06:30:00.000Z'))
    store.upsertReceipt('s2', 'turn_a', receipt('2026-11-18T06:30:00.000Z'))
    store.clearSession('s1')
    expect(store.forAnchor('s1', 'turn_a')).toBeUndefined()
    expect(store.forAnchor('s2', 'turn_a')?.updatedAt).toBe('2026-11-18T06:30:00.000Z')
  })
})
