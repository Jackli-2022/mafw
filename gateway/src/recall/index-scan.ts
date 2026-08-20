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
// The index text is ~10-15k tokens for 300+ entries — well within mimo's
// 1M context window and prompt cache sweet spot.

import type { HarmonicIndexManager } from '../core/memory/harmonic-index';
import type { MemoryWorker } from './memory-worker';
import { log } from '../core/utils/logger';

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
  /** Max IDs to return from scan (default 5). */
  maxIds?: number;
}

const SCAN_SYSTEM = `You are a memory retrieval system. Given a memory index and a user query, identify the most relevant memory entries.

The index lists memories in this format:
- [id:<short_id>] (<date>) <type> | <summary> | anchors: <keywords>

Return ONLY valid JSON (no markdown):
{"relevant_ids": ["<short_id>", ...], "reasoning": "<one sentence>", "confidence": <0.0-1.0>}

Rules:
- Select at most 5 entries that are most relevant to the query
- Consider semantic relevance, not just keyword matching
- For preference queries (what does the user like/dislike), prioritize entries with "preference" type or "pref:" anchors
- For temporal queries (when/what happened), prioritize entries with matching dates
- For multi-session queries (what did we discuss about X), look for entries sharing topic anchors
- confidence = how sure you are that the selected entries answer the query (0.0 = guess, 1.0 = certain)
- If nothing is relevant, return {"relevant_ids": [], "reasoning": "no relevant memories", "confidence": 0.0}`;

/**
 * Format a single harmonic index entry into a compact index line.
 * Three fields: absolute date, type, anchors — all critical for scan quality.
 */
export function formatEntryForIndex(entry: any): string {
  const id = (entry.id || '?').slice(0, 12);
  const date = formatDateOnly(entry.created_at);
  const type = entry.type || 'unknown';
  const summary = (entry.primary_abstraction || '').replace(/\n/g, ' ').slice(0, 80);
  const anchors = (entry.cue_anchors || []).slice(0, 5).join(', ');
  const energy = typeof entry.energy === 'number' ? entry.energy.toFixed(1) : '?';
  return `- [id:${id}] (${date}) ${type} | ${summary} | anchors: ${anchors} | E:${energy}`;
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
 * Excludes superseded entries. Sorted by created_at descending (newest first).
 */
export function formatIndexForScan(index: HarmonicIndexManager): string {
  const entries = index.getIndex().entries
    .filter((e: any) => !e.superseded_by)
    .sort((a: any, b: any) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta; // newest first
    });

  const lines = entries.map(formatEntryForIndex);
  return `# Memory Index (${entries.length} entries)\n\n${lines.join('\n')}`;
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

    // Deduplicate concurrent scans
    if (this.inFlight) return this.inFlight;

    this.inFlight = this._doScan(query, timeoutMs, minConfidence);
    try {
      return await this.inFlight;
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
        worker.prompt(prompt, SCAN_SYSTEM, this.workerModel),
        new Promise<string>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('scan timeout')), timeoutMs);
          timer.unref?.();
        }),
      ]);

      const result = parseScanResponse(response);
      if (!result) return null;

      // Resolve short IDs to full IDs
      result.relevantIds = resolveShortIds(result.relevantIds, this.index);

      // Filter by confidence threshold
      if (result.confidence < minConfidence) {
        log.info(`[IndexScan] low confidence ${result.confidence} < ${minConfidence}, discarding`);
        return null;
      }

      return result;
    } catch (err: any) {
      log.warn(`[IndexScan] scan failed: ${err.message}`);
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
