import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

describe('MemoryReceipt wiring', () => {
  test('renders a 300ms hover card with the receipt view', () => {
    const src = read('./components/MemoryReceipt.tsx')
    expect(src).toContain('HoverCard')
    expect(src).toContain('openDelay={300}')
    expect(src).toContain('mafw-memory-receipt-trigger')
    expect(src).toContain('view.primary')
    expect(src).toContain('view.neighbors')
    expect(src).toContain('view.neighborLabel')
    expect(src).toContain('view.t1')
    expect(src).toContain('onOpenMemory')
    expect(src).not.toContain('mafw-memory-receipt-pill')
    expect(src).not.toContain('mafw-memory-receipt-tag')
  })

  test('keeps the quiet trigger and compact card contract', () => {
    const src = read('./components/MemoryReceipt.tsx')
    expect(src).toContain('aria-expanded={showNeighbors()}')
    expect(src).toContain('setShowNeighbors')
    const css = read('./mafw.css')
    expect(css).not.toContain('.mafw-memory-receipt-pill')
    expect(css).toMatch(/\.mafw-memory-receipt-trigger\[data-component="button-v2"\] \{[^}]*font-size: 11\.5px/)
    expect(css).toMatch(/\.mafw-memory-receipt-card \{[^}]*width: 340px/)
    expect(css).toMatch(/\.mafw-turn-memory-receipt \{\s*margin: 4px 0 2px 25px;/)
  })
})
