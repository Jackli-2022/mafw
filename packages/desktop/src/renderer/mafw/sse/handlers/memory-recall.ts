import type { MemoryReceiptDTO } from '@mafw/sdk'

export interface MemoryRecallDeps {
  getReceipt(anchorKey: string): MemoryReceiptDTO | undefined
  upsertReceipt(anchorKey: string, receipt: MemoryReceiptDTO): void
}

/**
 * `memory.recalled` → per-anchor receipt store. Same `updatedAt` is a no-op;
 * a newer receipt replaces the old one. Malformed frames are consumed silently
 * so a gateway version skew cannot spam the shell's unhandled-event warning.
 */
export function handleMemoryRecallEvent(event: any, deps: MemoryRecallDeps): boolean {
  if (event?.type !== 'memory.recalled') return false
  const properties = event?.properties ?? event
  const anchorKey = properties?.anchorKey
  const receipt = properties?.receipt
  if (typeof anchorKey !== 'string' || !anchorKey || !receipt) return true

  const current = deps.getReceipt(anchorKey)
  if (current && String(current.updatedAt) >= String(receipt.updatedAt)) return true

  try {
    deps.upsertReceipt(anchorKey, receipt)
  } catch {
    /* fail-open: a receipt store failure must not break the SSE pump */
  }
  return true
}
