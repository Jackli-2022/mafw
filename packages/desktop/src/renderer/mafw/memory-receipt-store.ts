import { createSignal } from 'solid-js'
import type { MemoryReceiptDTO } from '@mafw/sdk'

const keyOf = (sessionID: string, anchorKey: string) => `${sessionID}\u0000${anchorKey}`

/**
 * Per-session receipt store. Keys include the session because turn anchors are
 * only unique inside a session. Older `updatedAt` never replaces a newer one.
 */
export function createMemoryReceiptStore() {
  const [state, setState] = createSignal<Record<string, MemoryReceiptDTO>>({})

  const getReceipt = (sessionID: string, anchorKey: string): MemoryReceiptDTO | undefined =>
    state()[keyOf(sessionID, anchorKey)]

  const upsertReceipt = (sessionID: string, anchorKey: string, receipt: MemoryReceiptDTO): void => {
    if (!sessionID || !anchorKey || !receipt) return
    setState((prev) => {
      const key = keyOf(sessionID, anchorKey)
      const current = prev[key]
      if (current && String(current.updatedAt) >= String(receipt.updatedAt)) return prev
      return { ...prev, [key]: receipt }
    })
  }

  const hydrate = (sessionID: string, items: Array<{ anchorKey: string; receipt: MemoryReceiptDTO }>): void => {
    for (const item of items ?? []) upsertReceipt(sessionID, item?.anchorKey, item?.receipt)
  }

  const clearSession = (sessionID: string): void => {
    const prefix = `${sessionID}\u0000`
    setState((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (key.startsWith(prefix)) delete next[key]
      }
      return next
    })
  }

  return {
    getReceipt,
    upsertReceipt,
    forAnchor: getReceipt,
    hydrate,
    clearSession,
  }
}

export type MemoryReceiptStore = ReturnType<typeof createMemoryReceiptStore>

/** Module singleton shared by the SSE dispatcher and ChatPane. */
export const memoryReceiptStore = createMemoryReceiptStore()
