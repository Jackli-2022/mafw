import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

describe('MemoryReceipt wiring', () => {
  test('renders a click-to-open floating peek with the receipt view', () => {
    const src = read('./components/MemoryReceipt.tsx')
    expect(src).toContain('PopoverShell')
    expect(src).toContain('anchor="below-start"')
    expect(src).toContain('width={320}')
    expect(src).toContain('mafw-memory-receipt-trigger')
    expect(src).toContain('aria-expanded={open()}')
    expect(src).toContain('view.primary')
    expect(src).toContain('view.neighbors')
    expect(src).toContain('view.neighborLabel')
    expect(src).toContain('view.t1')
    expect(src).toContain('onOpenMemory')
    expect(src).not.toContain('HoverCard')
    expect(src).not.toContain('mafw-memory-receipt-pill')
    expect(src).not.toContain('mafw-memory-receipt-tag')
  })

  test('keeps the quiet trigger and compact card contract', () => {
    const src = read('./components/MemoryReceipt.tsx')
    expect(src).toContain('aria-expanded={showNeighbors()}')
    expect(src).toContain('setShowNeighbors')
    expect(src).toContain('event.stopPropagation()')
    const css = read('./mafw.css')
    expect(css).not.toContain('.mafw-memory-receipt-pill')
    expect(css).toMatch(/\.mafw-memory-receipt-trigger\[data-component="button-v2"\] \{[^}]*font-size: 11\.5px/)
    expect(css).toMatch(/\.mafw-memory-receipt-pop \{[^}]*max-height: 400px/)
    expect(css).toMatch(/\.mafw-turn-memory-receipt \{\s*margin: 10px 0 0;/)
  })

  test('renders inside the turn text part, before the action/meta row', () => {
    const turn = read('../../../../session-ui/src/components/session-turn.tsx')
    expect(turn).toContain('renderTurnFooter')
    expect(turn).toContain('turnFooterPartID={showAssistantCopyPartID()}')
    const part = read('../../../../session-ui/src/components/message-part.tsx')
    expect(part).toContain('turnFooter')
    expect(part).toContain('props.turnFooter?.()')
    expect(part).toContain('props.part.id === props.turnFooterPartID')
  })
})
