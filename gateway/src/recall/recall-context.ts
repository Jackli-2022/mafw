// /api/recall/context search + filter. Supports two retrieval modes:
// 1. BM25 only (fast, <20ms) — used by step injection
// 2. BM25 + index scan parallel (slower, ~1-2s) — used by boundary recall
//
// The index scan catches semantic matches that BM25 misses (preference queries,
// paraphrase, cross-session aggregation). Results are unioned and deduped.
import type { HarmonicIndexManager } from '../core/memory/harmonic-index'
import type { IndexScanService, ScanResult } from './index-scan'
import { config } from '../config'
import { log } from '../core/utils/logger'

/**
 * Detect multi-hop/comparison questions that need facts from multiple sessions.
 * Returns sub-queries that decompose the question into independent searches.
 */
function decomposeMultiHopQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const subQueries: string[] = [];

  // Comparison patterns: "how much older/younger", "difference between", "compare", "vs"
  const isComparison = /\b(how much|what is the|difference between|compare|vs\.?|older|younger|more|less|bigger|smaller|higher|lower|faster|slower|better|worse)\b/i.test(query);
  
  // Temporal/aggregation: "average", "total", "sum", "count", "when did"
  const hasAggregation = /\b(average|total|sum|count|how many|how often|when did|what time|which)\b/i.test(query);

  if (isComparison || hasAggregation) {
    // Extract noun phrases as entity candidates
    // Simple heuristic: words that are not common question words
    const questionWords = new Set(['how', 'what', 'when', 'where', 'why', 'which', 'who', 'whom', 'whose', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'shall', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into', 'than', 'that', 'this', 'these', 'those', 'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'i', 'me', 'we', 'you', 'they', 'he', 'she']);
    
    const words = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !questionWords.has(w));
    
    // Sub-query 1: personal/user info patterns
    const userPatterns = words.filter(w => /\b(age|birthday|born|live|work|job|salary|income|family|married|single|children|kid|pet|car|house|home|school|college|university|degree|major|hobby|interest|preference|like|dislike|favorite|eat|drink|travel|visit|read|watch|listen)\b/.test(w));
    if (userPatterns.length > 0) {
      subQueries.push('user ' + userPatterns.join(' '));
    }
    
    // Sub-query 2: entity/topic patterns  
    const entityWords = words.filter(w => !userPatterns.includes(w));
    if (entityWords.length > 0) {
      subQueries.push(entityWords.join(' '));
    }
    
    // Sub-query 3: the full noun phrase (without question words)
    if (words.length >= 2) {
      subQueries.push(words.join(' '));
    }
  }
  
  return subQueries.slice(0, 4); // Cap at 4 sub-queries
}

/**
 * Extract key entities from a query for cross-session topic linking.
 * Looks for quoted strings, camelCase/PascalCase identifiers, ALL_CAPS words,
 * common technical terms, and natural language entity nouns.
 */
function extractQueryEntities(query: string): string[] {
  const entities: string[] = [];
  
  // Quoted strings (e.g., "React", 'auth module')
  const quoted = query.match(/['"]([^'"]+)['"]/g);
  if (quoted) {
    for (const q of quoted) {
      const inner = q.slice(1, -1).trim();
      if (inner.length >= 2) entities.push(inner);
    }
  }
  
  // camelCase/PascalCase identifiers (e.g., "getUserAuth", "AuthModule")
  const camelPascal = query.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
  if (camelPascal) {
    for (const c of camelPascal) {
      entities.push(c);
      // Also add split version: "getUserAuth" -> "get User Auth"
      const split = c.replace(/([a-z])([A-Z])/g, '$1 $2');
      if (split !== c) entities.push(split);
    }
  }
  
  // ALL_CAPS words (e.g., "API", "URL", "HTTP")
  const allCaps = query.match(/\b[A-Z]{2,}\b/g);
  if (allCaps) {
    for (const a of allCaps) {
      if (a.length >= 2 && !['THE', 'AND', 'FOR', 'NOT', 'BUT', 'ARE', 'WAS', 'HAS', 'CAN', 'DID', 'DOES'].includes(a)) {
        entities.push(a);
      }
    }
  }
  
  // Natural language entity nouns (common content words that appear in memories)
  const lower = query.toLowerCase();
  const nlEntities = lower.match(/\b(?:age|birthday|salary|income|department|employee|manager|team|company|project|product|feature|service|server|database|api|endpoint|config|setting|preference|language|framework|library|tool|plugin|extension|theme|template|pattern|convention|standard|protocol|interface|model|schema|type|class|function|method|module|package|library|framework|component|file|directory|path|url|link|user|admin|role|permission|access|session|token|auth|oauth|jwt|deploy|build|test|debug|error|exception|log|monitor|metric|alert|notification|webhook|cron|schedule|timer|cache|queue|stack|tree|graph|node|edge|list|map|set|dict|array|string|number|boolean|null|undefined|true|false|yes|no|ok|done|failed|success|pending|active|inactive|enabled|disabled|public|private|internal|external|local|remote|global|shared|custom|default|primary|secondary|main|sub|child|parent|root|head|tail|first|last|next|prev|current|old|new|temporary|permanent)\b/g);
  if (nlEntities) {
    for (const e of nlEntities) {
      if (e.length >= 3 && !entities.includes(e)) {
        entities.push(e);
      }
    }
  }
  
  // Deduplicate and return (case-insensitive dedup)
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const e of entities) {
    const lower = e.toLowerCase();
    if (!seen.has(lower) && lower.length >= 2) {
      seen.add(lower);
      unique.push(e);
    }
  }
  return unique.slice(0, 10); // Cap at 10 entities
}

/**
 * Expand a query by searching for entity-related memories.
 * Uses both entity extraction and multi-hop decomposition to catch
 * cross-session topic links that BM25 might miss.
 */
function expandQuery(
  index: Pick<HarmonicIndexManager, 'search'>,
  query: string,
  pushed: Set<string>,
  topK: number = 3,
): { id: string; score: number }[] {
  const expandedScores = new Map<string, number>();
  
  // Strategy 1: entity-based expansion (individual entity searches)
  const entities = extractQueryEntities(query);
  for (const entity of entities) {
    const hits = (index.search(entity, topK, {}) || []) as any[];
    for (const hit of hits) {
      if (pushed.has(hit.id)) continue;
      if ((hit as any).superseded_by) continue;
      const existing = expandedScores.get(hit.id) || 0;
      expandedScores.set(hit.id, existing + (hit.energy || 0) * 0.5);
    }
  }
  
  // Strategy 2: multi-hop decomposition (sub-query searches)
  const subQueries = decomposeMultiHopQuery(query);
  for (const sq of subQueries) {
    const hits = (index.search(sq, topK, {}) || []) as any[];
    for (const hit of hits) {
      if (pushed.has(hit.id)) continue;
      if ((hit as any).superseded_by) continue;
      const existing = expandedScores.get(hit.id) || 0;
      // Sub-query hits get a slightly lower weight than entity hits
      expandedScores.set(hit.id, existing + (hit.energy || 0) * 0.35);
    }
  }
  
  // Sort by accumulated score
  return [...expandedScores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2);
}

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

  // Query expansion: search for entity-related memories (cross-session linking)
  const expandedResults = expandQuery(index, query, pushed, topK)
  for (const exp of expandedResults) {
    if (resultMap.has(exp.id)) continue; // Already from BM25 — don't override
    const entry = (index as any).getIndex?.()?.entries?.find((e: any) => e.id === exp.id)
    if (!entry || (entry as any).superseded_by) continue
    resultMap.set(exp.id, {
      id: exp.id,
      primary_abstraction: entry.primary_abstraction || '',
      memory_value: (entry as any).memory_value || (entry as any).content || '',
      energy: entry.energy || 0,
      score: exp.score,
      type: entry.type,
      created_at: entry.created_at,
      source: 'expansion',
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
          const neighbors = graphStore.getNeighbors([id], config.search.graph.maxNeighbors, new Set(scanResult.relevantIds))
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
