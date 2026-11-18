import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

describe('memory receipt ChatPane wiring', () => {
  test('hydrates receipts on session open and renders them per turn', () => {
    const pane = read('./components/ChatPane.tsx')
    expect(pane).toContain('memoryReceipts')
    expect(pane).toContain('memoryReceiptStore.hydrate')
    expect(pane).toContain('receiptForTurn')
    expect(pane).toContain('<MemoryReceipt')
  })

  test('does not crash when an older preload lacks the receipts call', () => {
    const pane = read('./components/ChatPane.tsx')
    expect(pane).toContain('const memoryReceipts = window.api.mafw.sessions.memoryReceipts')
    expect(pane).toContain('typeof memoryReceipts !== "function"')
  })

  test('MafwShell passes the Memory page opener', () => {
    const shell = read('./MafwShell.tsx')
    expect(shell).toContain('onOpenMemory={() =>')
  })

  test('preload exposes the receipts call', () => {
    const preload = read('../../preload/mafw-api.ts')
    expect(preload).toContain('memoryReceipts')
    expect(preload).toContain('invoke("session", "memoryReceipts", sessionID, opts)')
  })
})
