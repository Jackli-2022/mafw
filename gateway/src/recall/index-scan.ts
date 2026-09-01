// Index scan: mimo reads the full harmonic index (formatted as compact text)
// and picks relevant memory IDs for a given query. This catches the semantic
// gap that BM25 misses — preference queries, paraphrase, cross-session
// aggregation. Runs in parallel with BM25 at boundary recall time.
//
// Architecture:
//   1. Index text is formatted once from .harmonic_index.json and cached
//      in memory. Refreshed hourly (piggybacks on turn-compress cron).
//   2. At recall time, the cached index text is sent as a prefix (prompt
//      cache friendly) with the user query as suffix.
//   3. mimo returns JSON with relevant IDs + confidence.
//   4. Results are unioned with BM25 results, deduped, superseded filtered.
//
// Cache-first design (the dominant cost lever is prompt-cache hit rate):
//   - Static header with NO entry count (a count changes on every write and
//     invalidates the provider cache from byte 0).
//   - Entries sorted oldest-first (append-only): refresh after new writes
//     only appends a tail, so the entire existing prefix stays byte-identical
//     and keeps hitting the provider prompt cache.
//   - No volatile fields in lines: energy decays daily and would invalidate
//     every line on each decay pass, so it is omitted (scan rules rank by
//     semantics; energy-based ranking stays with BM25).
//   - The query is always the final suffix — dynamic content last.
//
// The index text is ~10-15k tokens for 300+ entries — well within mimo's
// 1M context window and prompt cache sweet spot.

import type { HarmonicIndexManager } from '../core/memory/harmonic-index';
import type { MemoryWorker } from './memory-worker';
import { log } from '../core/utils/logger';
import { HARD_BOUNDARIES } from '../skills/memory-curator-agent';

export interface ScanResult {
  relevantIds: string[];
  confidence: number;
  reasoning?: string;
}

export interface IndexScanOptions {
  /** Timeout for the mimo scan call (default 10s). */
  timeoutMs?: number;
  /** Minimum confidence to include scan results (default 0.3). */
  minConfidence?: number;
  /** Max IDs to return from scan (default 8). */
  maxIds?: number;
}

const SCAN_SYSTEM = `You are a memory retrieval system. Given a memory index and a user query, identify the most relevant memory entries.

The index lists memories in this format:
- [id:<short_id>] (<date>) <type> | <summary> | anchors: <keywords>

Return ONLY valid JSON (no markdown):
{"relevant_ids": ["<short_id>", ...], "reasoning": "<one sentence>", "confidence": <0.0-1.0>}

Rules:
- You MUST return 5-8 entry IDs. If the index has entries at all, return at least 5.
- Return MORE entries rather than fewer — false negatives are worse than false positives
- Rank them by relevance (most relevant first)
- Consider semantic relevance, not just keyword matching — look for topic overlap, related concepts, paraphrases
- For preference queries (what does the user like/dislike), prioritize entries with "preference" type or "pref:" anchors
- For temporal queries (when/what happened), prioritize entries with matching dates
- For multi-session queries (what did we discuss about X), look for entries sharing topic anchors
- If answering the question requires combining information from multiple memories, include ALL relevant entries
- confidence = how sure you are that the selected entries answer the query (0.0 = guess, 1.0 = certain)
- If nothing is relevant, return {"relevant_ids": [], "reasoning": "no relevant memories", "confidence": 0.0}
${HARD_BOUNDARIES}`;

/**
 * Format a single harmonic index entry into a compact index line.
 * Only immutable fields are included (date, type, summary, anchors) —
 * volatile fields like energy would invalidate the provider prompt cache
 * on every decay pass.
 */
export function formatEntryForIndex(entry: any): string {
  const id = (entry.id || '?').slice(0, 12);
  const date = formatDateOnly(entry.created_at);
  const type = entry.type || 'unknown';
  // Don't truncate abstraction — let the model see full content for better relevance judgment
  const summary = (entry.primary_abstraction || '').replace(/\n/g, ' ');
  const anchors = (entry.cue_anchors || []).slice(0, 5).join(', ');
  return `- [id:${id}] (${date}) ${type} | ${summary} | anchors: ${anchors}`;
}

function formatDateOnly(iso?: string): string {
  if (!iso) return 'unknown';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'unknown';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return 'unknown';
  }
}

/**
 * Format the full harmonic index into a compact text block for mimo scanning.
 * Excludes superseded entries. Sorted by created_at ASCENDING (oldest first)
 * so the text is append-only: after new writes the refreshed text keeps the
 * entire previous prefix byte-identical, preserving provider prompt-cache
 * hits across hourly refreshes. Header is static (no entry count) for the
 * same reason.
 */
export function formatIndexForScan(index: HarmonicIndexManager): string {
  const entries = index.getIndex().entries
    .filter((e: any) => !e.superseded_by)
    .sort((a: any, b: any) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb; // oldest first — append-only order
    });

  const lines = entries.map(formatEntryForIndex);
  return `# Memory Index\n\n${lines.join('\n')}`;
}

/**
 * Parse mimo's scan response into structured result.
 * Tolerant of markdown fences and extra text around JSON.
 */
export function parseScanResponse(text: string): ScanResult | null {
  if (!text?.trim()) return null;
  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed?.relevant_ids)) return null;
    return {
      relevantIds: parsed.relevant_ids.filter((id: any) => typeof id === 'string').slice(0, 10),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve short IDs from scan response to full harmonic index entry IDs.
 * The index uses 12-char prefixes; this maps them back to full IDs.
 */
export function resolveShortIds(shortIds: string[], index: HarmonicIndexManager): string[] {
  const entries = index.getIndex().entries;
  const resolved: string[] = [];
  for (const shortId of shortIds) {
    const match = entries.find((e: any) => e.id.startsWith(shortId));
    if (match) resolved.push(match.id);
  }
  return resolved;
}

/**
 * IndexScanService manages the scan worker and cached index text.
 * Created once by the gateway, reused across all recall calls.
 */
export class IndexScanService {
  private cachedIndexText: string | null = null;
  private cachedAt: number = 0;
  private inFlight: Promise<ScanResult | null> | null = null;
  // Failure cooldown state: a slow or broken worker model must not burn a
  // disposable session on every recall call. Exponential backoff (1/2/4 min,
  // capped); a healthy scan resets the streak. Low-confidence results are
  // healthy "no match" answers and do NOT arm the cooldown.
  private lastFailAt = 0;
  private consecutiveFails = 0;
  private lastAttemptFailed = false;

  constructor(
    private index: HarmonicIndexManager,
    private workerFactory: () => MemoryWorker,
    private workerModel?: { providerID: string; modelID: string },
  ) {}

  /** Refresh the cached index text. Called hourly by turn-compress cron. */
  refreshCache(): void {
    this.cachedIndexText = formatIndexForScan(this.index);
    this.cachedAt = Date.now();
    log.info(`[IndexScan] cache refreshed: ${this.cachedIndexText.split('\n').length - 2} entries`);
  }

  /** Get the cached index text, refreshing if needed. */
  getIndexText(): string {
    if (!this.cachedIndexText) {
      this.refreshCache();
    }
    return this.cachedIndexText!;
  }

  /**
   * Run a scan: send cached index + query to mimo, parse response.
   * Returns null on failure (fail-open: caller falls back to BM25 only).
   * Deduplicates concurrent calls — if a scan is already in-flight for the
   * same query, returns the same promise.
   */
  async scan(query: string, options: IndexScanOptions = {}): Promise<ScanResult | null> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const minConfidence = options.minConfidence ?? 0.3;

    // Failure cooldown (exponential backoff: 1/2/4 min, capped)
    if (this.consecutiveFails > 0) {
      const cooldown = Math.min(60_000 * 2 ** (this.consecutiveFails - 1), 240_000);
      if (Date.now() - this.lastFailAt < cooldown) return null;
    }

    // Deduplicate concurrent scans
    if (this.inFlight) return this.inFlight;

    this.inFlight = this._doScan(query, timeoutMs, minConfidence);
    try {
      const result = await this.inFlight;
      if (this.lastAttemptFailed) {
        this.consecutiveFails++;
        this.lastFailAt = Date.now();
      } else {
        this.consecutiveFails = 0;
      }
      return result;
    } finally {
      this.inFlight = null;
    }
  }

  private async _doScan(query: string, timeoutMs: number, minConfidence: number): Promise<ScanResult | null> {
    // Create a fresh worker for each scan (stateless) — prevents session
    // history accumulation that causes O(n²) token growth and timeouts.
    const worker = this.workerFactory();
    try {
      const indexText = this.getIndexText();
      const prompt = `${indexText}\n\n---\n\nUser query: ${query}\n\nSelect the most relevant memory entries from the index above.`;

      const response = await Promise.race([
        worker.prompt(prompt, SCAN_SYSTEM, this.workerModel, 'memory-curator'),
        new Promise<string>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('scan timeout')), timeoutMs);
          timer.unref?.();
        }),
      ]);

      const result = parseScanResponse(response);
      if (!result) {
        this.lastAttemptFailed = true; // unparsable output — model likely broken
        return null;
      }

      // Resolve short IDs to full IDs
      result.relevantIds = resolveShortIds(result.relevantIds, this.index);

      // Filter by confidence threshold
      if (result.confidence < minConfidence) {
        log.info(`[IndexScan] low confidence ${result.confidence} < ${minConfidence}, discarding`);
        this.lastAttemptFailed = false; // healthy "no match"
        return null;
      }

      this.lastAttemptFailed = false;
      return result;
    } catch (err: any) {
      log.warn(`[IndexScan] scan failed: ${err.message}`);
      this.lastAttemptFailed = true;
      return null;
    } finally {
      // Dispose the one-shot worker (frees the opencode session)
      void worker.dispose().catch(() => {});
    }
  }

  /** Dispose is now a no-op — each scan creates and disposes its own worker. */
  async dispose(): Promise<void> {
    // No persistent worker to dispose.
  }
}
