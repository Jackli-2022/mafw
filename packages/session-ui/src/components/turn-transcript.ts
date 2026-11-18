// Pure turn grouping for the process timeline. The rule is deliberately
// lossless: text outputs are never folded away, and write/action cards stay
// top-level. A segment is one contiguous "process burst" followed by its
// output; a tool/reasoning step after output starts a new segment.

import type { MafwPart } from '@mafw/sdk'
import { displayToolOf, TIMELINE_TOOLS } from './parts-rules'

type TextPart = Extract<MafwPart, { type: 'text' }>
type ReasoningPart = Extract<MafwPart, { type: 'reasoning' }>
type ToolPart = Extract<MafwPart, { type: 'tool' }>

export type ProcessStep =
  | { type: 'thinking'; key: string; parts: ReasoningPart[] }
  | { type: 'tool'; key: string; part: ToolPart; tool: string }

export type TurnEntry =
  | { type: 'segment'; key: string; process: ProcessStep[]; output: TextPart[] }
  | { type: 'card'; key: string; part: ToolPart }
  | { type: 'data'; key: string; part: MafwPart }

export function isTimelineTool(tool: string): boolean {
  return TIMELINE_TOOLS.has(tool)
}

function isSynthetic(part: { synthetic?: boolean }): boolean {
  return part.synthetic === true
}

export function splitTurn(parts: MafwPart[], opts: { showReasoning: boolean }): TurnEntry[] {
  const entries: TurnEntry[] = []
  const state: { current: Extract<TurnEntry, { type: 'segment' }> | null } = { current: null }

  const flush = () => {
    const segment = state.current
    if (segment && (segment.process.length > 0 || segment.output.length > 0)) entries.push(segment)
    state.current = null
  }

  const ensureSegment = (key: string) => {
    if (!state.current) state.current = { type: 'segment', key, process: [], output: [] }
    return state.current
  }

  for (const part of parts ?? []) {
    if (!part) continue

    if (part.type === 'text') {
      if (isSynthetic(part)) continue
      const value = (part as TextPart).text?.trim()
      if (!value) continue
      ensureSegment(`seg:${part.id}`).output.push(part as TextPart)
      continue
    }

    if (part.type === 'reasoning') {
      if (!opts.showReasoning) continue
      const value = (part as ReasoningPart).text?.trim()
      if (!value) continue
      // Reasoning after output starts a new segment.
      if (state.current?.output.length) flush()
      const target = ensureSegment(`seg:${part.id}`)
      const last = target.process.at(-1)
      if (last?.type === 'thinking') last.parts.push(part as ReasoningPart)
      else target.process.push({ type: 'thinking', key: part.id, parts: [part as ReasoningPart] })
      continue
    }

    if (part.type === 'tool') {
      const tool = displayToolOf(part as ToolPart)
      if (isTimelineTool(tool)) {
        if (state.current?.output.length) flush()
        ensureSegment(`seg:${part.id}`).process.push({
          type: 'tool',
          key: part.id,
          part: part as ToolPart,
          tool,
        })
      } else {
        flush()
        entries.push({ type: 'card', key: part.id, part: part as ToolPart })
      }
      continue
    }

    // step markers / compaction are not timeline content; data/file/agent
    // parts are top-level entries and break the segment.
    if (part.type === 'step-start' || part.type === 'step-finish' || part.type === 'compaction') continue
    flush()
    entries.push({ type: 'data', key: part.id, part })
  }

  flush()
  return entries
}
