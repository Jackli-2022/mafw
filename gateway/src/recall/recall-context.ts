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
 * Extract key entities from a query for cross-session topic linking.
 * Looks for quoted strings, camelCase/PascalCase identifiers, ALL_CAPS words,
 * and common technical terms.
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
  
  // Common technical terms (lowercase, multi-char)
  const techTerms = query.match(/\b(?:api|sdk|plugin|module|function|method|class|interface|type|enum|config|settings|database|server|client|endpoint|route|handler|middleware|service|worker|queue|cache|token|session|user|admin|deploy|build|test|debug|error|exception|warning|log|logger|monitor|metric|alert|notification|webhook|callback|promise|async|await|stream|buffer|payload|header|body|request|response|auth|oauth|jwt|csrf|xss|sql|nosql|mongodb|postgres|mysql|redis|docker|kubernetes|k8s|aws|gcp|azure|lambda|sqs|sns|dynamodb|s3|ec2|iam|vpc|cdn|dns|ssl|tls|ssh|ftp|smtp|imap|pop3|grpc|rest|graphql|websocket|http|https|tcp|udp|ip|url|uri|urn|uuid|id|key|secret|password|token|hash|encrypt|decrypt|sign|verify|compress|decompress|encode|decode|parse|serialize|deserialize|validate|sanitize|transform|filter|map|reduce|sort|group|merge|split|join|concat|append|prepend|insert|delete|update|create|read|write|open|close|start|stop|pause|resume|retry|timeout|delay|schedule|cron|timer|interval|debounce|throttle|batch|queue|stack|heap|tree|graph|node|edge|vertex|link|pointer|reference|value|object|array|list|set|map|dict|tuple|struct|record|schema|model|entity|resource|collection|document|file|directory|folder|path|url|link|bookmark|tag|label|category|group|role|permission|access|scope|context|state|session|cookie|storage|cache|buffer|pool|factory|builder|adapter|proxy|decorator|facade|bridge|composite|flyweight|mediator|observer|strategy|template|command|iterator|mediator|memento|visitor|chain|state|specification|criteria|predicate|function|handler|listener|callback|hook|middleware|interceptor|filter|transform|mapper|serializer|deserializer|validator|sanitizer|formatter|parser|compiler|interpreter|transpiler|minifier|bundler|linter|formatter|test|mock|stub|spy|fixture|factory|builder|helper|util|utility|tool|kit|library|framework|package|module|component|plugin|extension|addon|theme|template|pattern|convention|standard|specification|protocol|interface|api|sdk|cli|gui|tui|web|mobile|desktop|server|client|peer|master|slave|leader|follower|primary|secondary|replica|shard|partition|segment|chunk|block|page|frame|slot|portal|modal|dialog|popup|tooltip|alert|toast|notification|message|event|signal|trigger|action|dispatch|emit|publish|subscribe|broadcast|unicast|multicast|anycast|loopback|localhost|127\.0\.0\.1|0\.0\.0\.0|::1|::0)\b/gi);
  if (techTerms) {
    for (const t of techTerms) {
      const lower = t.toLowerCase();
      if (!entities.includes(lower)) entities.push(lower);
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
 * This catches cross-session topic links that BM25 might miss.
 */
function expandQuery(
  index: Pick<HarmonicIndexManager, 'search'>,
  query: string,
  pushed: Set<string>,
  topK: number = 3,
): { id: string; score: number }[] {
  const entities = extractQueryEntities(query);
  if (entities.length === 0) return [];
  
  const expandedScores = new Map<string, number>();
  
  // Search for each entity
  for (const entity of entities) {
    const hits = (index.search(entity, topK, {}) || []) as any[];
    for (const hit of hits) {
      if (pushed.has(hit.id)) continue;
      if ((hit as any).superseded_by) continue;
      const existing = expandedScores.get(hit.id) || 0;
      expandedScores.set(hit.id, existing + (hit.energy || 0) * 0.5); // 0.5 weight for expansion
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
