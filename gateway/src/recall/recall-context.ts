// /api/recall/context search + filter. Extracted as a pure function so the
// pushed-memory filtering (path 1 / step-injection integration) is unit
// testable without booting the whole gateway.
import type { HarmonicIndexManager } from '../core/memory/harmonic-index'

export interface RecallMemory {
  id: string
  primary_abstraction: string
  memory_value: string
  energy: number
}

export interface SearchRecallOptions {
  retriever?: 'token' | 'bm25'
}

export function searchRecallMemories(
  index: Pick<HarmonicIndexManager, 'search'> | undefined,
  query: string,
  pushed: Set<string>,
  topK: number = 3,
  options: SearchRecallOptions = {},
): RecallMemory[] {
  if (!index) return []
  const results = index.search(query, topK * 2, options) || []
  return results
    .filter((e) => !pushed.has(e.id))
    .filter((e) => !(e as any).superseded_by)  // Gap 2: hide superseded from recall
    .slice(0, topK)
    .map((e) => ({
      id: e.id,
      primary_abstraction: e.primary_abstraction || '',
      memory_value: (e as any).memory_value || (e as any).content || '',
      energy: e.energy || 0,
      type: e.type,
      created_at: e.created_at,
    }))
}
