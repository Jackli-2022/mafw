import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')
const css = () => fs.readFileSync(new URL('./process-timeline.css', import.meta.url), 'utf-8')

describe('ProcessTimeline', () => {
  test('renders every tool step through the registered native card', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('props.renderCard(step.part)')
    expect(src).not.toContain('ToolRow')
    expect(src).not.toContain('CARD_TOOLS')
    expect(src).not.toContain('getToolInfo')
  })

  test('renders process inside a collapsible and output outside it', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('Collapsible')
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

  test('normalises native cards to the drawer rhythm', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('mafw-process-step-card')
    expect(src).toContain('Collapsible.Arrow')
    const styles = css()
    expect(styles).not.toContain('.mafw-process-tool-row')
    expect(styles).toContain('.mafw-process-step-card [data-slot="basic-tool-tool-title"]')
    expect(styles).toContain('.mafw-process-step-card [data-slot="basic-tool-tool-subtitle"]')
    expect(styles).toContain('.mafw-process-step-card [data-component="task-tool-title"]')
    expect(styles).toContain('.mafw-process-step-card [data-component="task-tool-icon"]')
    expect(styles).toContain('font-size: 11px')
    expect(styles).toContain('border: 0')
    expect(styles).toContain('.mafw-process-think-label')
  })

  test('keeps the card body while shrinking it to the drawer density', () => {
    const styles = css()
    expect(styles).toContain('.mafw-process-step-card [data-component="tool-output"]')
    expect(styles).toContain('.mafw-process-step-card [data-component="bash-output"] [data-slot="bash-pre"] code')
    expect(styles).toContain('.mafw-process-step-card .mafw-tool-box')
  })

  test('aligns expanded content with the collapsed title', () => {
    const styles = css()
    expect(styles).toContain('--mafw-tool-content-left: 6px')
    expect(styles).toContain('[data-scope="apply-patch"] h3 > button')
    expect(styles).toContain('padding-left: var(--mafw-tool-content-left)')
  })

  test('shared ToolCard owns the compact ChatView tokens', () => {
    const card = fs.readFileSync(new URL('./tool-card.css', import.meta.url), 'utf-8')
    expect(card).toContain('font-size: 11px')
    expect(card).toContain('font-size: 10.5px')
    expect(card).toContain('--mafw-tool-content-left: 6px')
    expect(card).toContain('calc(100% - 8px)')
    expect(css()).not.toMatch(/font-size:\s*14px/)
  })

  test('segment header reads one step larger than the tool rows', () => {
    const styles = css()
    expect(styles).toMatch(/\.mafw-process-seg-title\s*\{[^}]*font-size:\s*12px/)
    expect(styles).toMatch(/\.mafw-process-seg-title\s*\{[^}]*font-weight:\s*400/)
  })

  test('matches the edit card title size to the tool rows', () => {
    const styles = css()
    expect(styles).toContain('.mafw-process-step-card [data-slot="message-part-title-text"]')
    expect(styles).toContain('font-size: 11px')
  })

  test('hides the thinking preview once the body is open', () => {
    const src = read('./process-timeline.tsx')
    expect(src).toContain('<Show when={!open()}>')
    expect(src).toContain('mafw-process-think-preview')
  })
})
