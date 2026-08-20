// /api/recall/context search + filter. Supports two retrieval modes:
// 1. BM25 only (fast, <20ms) — used by step injection
// 2. BM25 + index scan parallel (slower, ~1-2s) — used by boundary recall
//
// The index scan catches semantic matches that BM25 misses (preference queries,
// paraphrase, cross-session aggregation). Results are unioned and deduped.
import type { HarmonicIndexManager } from '../core/memory/harmonic-index'
import type { IndexScanService, ScanResult } from './index-scan'
import { log } from '../core/utils/logger'

export interface RecallMemory {
  id: string
  primary_abstraction: string
  memory_value: string
  energy: number
  /** Composite score for ranking: energy + scan boost (0.3 for scan-only entries). */
  score: number
  type?: string
  created_at?: string
  /** Source: 'bm25', 'scan', or 'both' (appeared in both retrievers). */
  source?: string
}

export interface SearchRecallOptions {
  retriever?: 'token' | 'bm25'
  /** Index scan service for parallel semantic retrieval (optional). */
  scanService?: IndexScanService
  /** Enable parallel scan alongside BM25 (default false). */
  enableScan?: boolean
}

/**
 * Search recall memories using BM25, optionally augmented with index scan.
 * When scanService is provided and enableScan is true, both retrievers run
 * in parallel and results are unioned (deduped by ID, BM25 wins on conflict).
 */
export async function searchRecallMemories(
  index: Pick<HarmonicIndexManager, 'search'> | undefined,
  query: string,
  pushed: Set<string>,
  topK: number = 3,
  options: SearchRecallOptions = {},
): Promise<RecallMemory[]> {
  if (!index) return []

  // Run BM25 search (always)
  const bm25Promise = Promise.resolve(
    (index.search(query, topK * 2, options) || [])
      .filter((e: any) => !pushed.has(e.id))
      .filter((e: any) => !e.superseded_by)
  )

  // Run index scan in parallel (if enabled)
  let scanPromise: Promise<ScanResult | null> = Promise.resolve(null)
  if (options.enableScan && options.scanService) {
    scanPromise = options.scanService.scan(query).catch(() => null)
  }

  const [bm25Results, scanResult] = await Promise.all([bm25Promise, scanPromise])

  // Build result map (BM25 first — they win on conflict)
  const resultMap = new Map<string, RecallMemory>()
  for (const e of bm25Results) {
    resultMap.set(e.id, {
      id: e.id,
      primary_abstraction: e.primary_abstraction || '',
      memory_value: (e as any).memory_value || (e as any).content || '',
      energy: e.energy || 0,
      score: e.energy || 0,
      type: e.type,
      created_at: e.created_at,
      source: 'bm25',
    })
  }

  // Merge scan results (skip IDs already from BM25)
  if (scanResult && scanResult.relevantIds.length > 0) {
    const indexEntries = (index as any).getIndex?.()?.entries || []

    // Anchor graph 1-hop expansion: for each scan-selected ID, bring in its
    // graph neighbors. This catches multi-session relationships that the
    // scan alone might miss (e.g., scan picks "restaurant" but not "hotel
    // near the restaurant" — the graph edge connects them).
    const graphStore = (index as any).getAnchorGraphStore?.()
    const expandedIds = new Set<string>(scanResult.relevantIds)
    if (graphStore) {
      for (const id of scanResult.relevantIds) {
        try {
          const neighbors = graphStore.getNeighbors([id], 3, new Set(scanResult.relevantIds))
          for (const [nbId] of neighbors) {
            expandedIds.add(nbId)
          }
        } catch { /* non-fatal */ }
      }
    }

    for (const id of expandedIds) {
      if (resultMap.has(id)) {
        // Already from BM25 — mark as 'both'
        resultMap.get(id)!.source = 'both'
        continue
      }
      if (pushed.has(id)) continue
      const entry = indexEntries.find((e: any) => e.id === id)
      if (!entry || entry.superseded_by) continue
      const isDirectScan = scanResult.relevantIds.includes(id)
      const baseEnergy = entry.energy || 0
      resultMap.set(id, {
        id: entry.id,
        primary_abstraction: entry.primary_abstraction || '',
        memory_value: (entry as any).memory_value || (entry as any).content || '',
        energy: baseEnergy,
        score: isDirectScan ? baseEnergy + 0.3 : baseEnergy + 0.15,
        type: entry.type,
        created_at: entry.created_at,
        source: isDirectScan ? 'scan' : 'scan+graph',
      })
    }
    log.info(`[Recall] bm25=${bm25Results.length} scan=${scanResult.relevantIds.length} expanded=${expandedIds.size} union=${resultMap.size} confidence=${scanResult.confidence}`)
  }

  // Sort by score descending (energy + scan boost), then slice to topK
  const results = [...resultMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return results
}

/**
 * Synchronous BM25-only search (backward compatible).
 * Used by step injection and other latency-sensitive paths.
 */
export function searchRecallMemoriesSync(
  index: Pick<HarmonicIndexManager, 'search'> | undefined,
  query: string,
  pushed: Set<string>,
  topK: number = 3,
  options: SearchRecallOptions = {},
): RecallMemory[] {
  if (!index) return []
  const results = index.search(query, topK * 2, options) || []
  return results
    .filter((e: any) => !pushed.has(e.id))
    .filter((e: any) => !e.superseded_by)
    .slice(0, topK)
    .map((e) => ({
      id: e.id,
      primary_abstraction: e.primary_abstraction || '',
      memory_value: (e as any).memory_value || (e as any).content || '',
      energy: e.energy || 0,
      score: e.energy || 0,
      type: e.type,
      created_at: e.created_at,
      source: 'bm25',
    }))
}
