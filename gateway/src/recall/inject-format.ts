interface MemoryUnit {
  id?: string
  primary_abstraction?: string
  cue_anchors?: string[]
  memory_value?: string
  energy?: number
}

export interface RecallFormat {
  pointers: string | null
  constraints: string | null
}

const POINTER_HEADER = `[鑱旀兂绾跨储 路 渚濇嵁鍓嶈鐢ㄥ伐鍏烽獙璇乚`

const TAG = `<mafw-recall>`
const END_TAG = `</mafw-recall>`

export function formatRecallContext(memories: MemoryUnit[], constraints: string[] = []): RecallFormat {
  const pointers = memories.length > 0
    ? `${TAG}\n${POINTER_HEADER}\n${memories.slice(0, 3).map(m =>
      `- #mem-${(m.id || '?').slice(0, 6)} "${m.primary_abstraction || m.memory_value || '?'}" (E:${typeof m.energy === 'number' ? m.energy.toFixed(1) : '?'})`
    ).join('\n')}\n${END_TAG}`
    : null

  const constraintsBlock = constraints.length > 0
    ? `<mafw-constraints>\n${constraints.join('\n')}\n</mafw-constraints>`
    : null

  return { pointers, constraints: constraintsBlock }
}
