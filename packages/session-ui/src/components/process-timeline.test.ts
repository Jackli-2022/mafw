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

  test('uses the naked thinking duration and a collapsed 思考 row', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('已思考 ${duration}')
    expect(src).not.toContain('已思考（用时')
    expect(src).toContain('mafw-process-think-label')
    expect(src).toContain('>思考</span>')
  })

  test('tools are borderless rows without a leading icon', () => {
    const src = read('./process-timeline.tsx')
    expect(src).not.toContain('mafw-process-tool-icon')
    expect(src).toContain('mafw-process-step-card')
    expect(src).toContain('Collapsible.Arrow')
    const css = fs.readFileSync(new URL('./process-timeline.css', import.meta.url), 'utf-8')
    expect(css).toContain('.mafw-process-tool-row')
    expect(css).toContain('border: 0')
    expect(css).toContain('.mafw-process-think-label')
  })
})
