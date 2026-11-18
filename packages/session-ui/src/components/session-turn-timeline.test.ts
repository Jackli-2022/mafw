import * as fs from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { isTopLevelToolEntry } from './parts-rules'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

describe('SessionTurn timeline wiring', () => {
  test('uses ProcessTimeline behind the flag and keeps the old fallback', () => {
    const src = read('./session-turn.tsx')
    expect(src).toContain('ProcessTimeline')
    expect(src).toContain('useProcessTimeline')
    expect(src).toContain('AssistantParts')
    expect(src).toContain('renderAfterPart')
    expect(src).toContain('renderOutput')
  })

  test('timeline tools are no longer top-level cards', () => {
    const part = { type: 'tool', tool: 'read', state: { status: 'completed' } } as any
    expect(isTopLevelToolEntry(part)).toBe(false)
  })

  test('timeline cards keep the shell/edit defaults and assistant actions', () => {
    const src = read('./session-turn.tsx')
    expect(src).toContain('partDefaultOpen')
    expect(src).toContain('shellToolDefaultOpen')
    expect(src).toContain('editToolDefaultOpen')
    expect(src).toContain('assistantActions={props.assistantActions}')
  })
})
