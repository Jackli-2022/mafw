import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

describe('MemoryReceipt wiring', () => {
  test('renders a 300ms hover card with the receipt view', () => {
    const src = read('./components/MemoryReceipt.tsx')
    expect(src).toContain('HoverCard')
    expect(src).toContain('openDelay={300}')
    expect(src).toContain('mafw-memory-receipt-pill')
    expect(src).toContain('view.memories')
    expect(src).toContain('view.t1')
    expect(src).toContain('view.filteredLine')
    expect(src).toContain('onOpenMemory')
  })
})
