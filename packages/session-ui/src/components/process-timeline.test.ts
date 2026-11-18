import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

describe('ProcessTimeline', () => {
  test('renders process inside a collapsible and output outside it', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('Collapsible')
    expect(src).toContain('ToolRow')
    expect(src).toContain('entry.output')
    expect(src).toContain('正在思考')
    expect(src).toContain('已思考')
    expect(src).toContain('TextShimmer')
    expect(src).toContain('Markdown')
  })

  test('uses a clean check icon instead of a glyph-in-circle', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('<Icon name="check"')
    expect(src).toContain('mafw-process-seg-pulse')
    expect(src).not.toContain("active() ? '✦'")
  })
})
