// Index scan: a cheap worker-model call reads the full harmonic index
// (formatted as compact text) and picks relevant memory IDs for a given query.
// This catches the semantic gap that BM25 misses — preference queries,
// paraphrase, cross-session aggregation.
//
// Transport: direct OpenAI-compatible HTTP chat completion (NOT an opencode
// session). The scan is a stateless classification call — a session adds
// create/prompt/delete churn and a per-session prompt-cache key for zero
// benefit, and one-shot sessions flooded the session registry.
//
// Cache-first design (the dominant cost lever is provider prompt-cache hits):
//   - The index text is a cacheable prefix: static header (no entry count),
//     entries sorted oldest-first (append-only), no volatile fields (energy
//     omitted), and an explicit `cache_control: ephemeral` marker on the
//     index block → deterministic DashScope explicit-cache hits (10% input
//     billing, 5-min TTL reset on hit) instead of best-effort implicit cache.
//   - The query is always the final suffix — dynamic content last.
//
// The index text is ~25-30k tokens for 690 entries — well within the model's
// context window. Scan latency with a warm cache is a few seconds; results
// are consumed via async prefetch snapshots, never on the sync recall path
// (the plugin client aborts recall requests after 100ms).

import type { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { log } from '../core/utils/logger';
import { HARD_BOUNDARIES } from '../skills/memory-curator-agent';
import { getProviderApiKey } from '../runtime/auth';

export interface ScanResult {
  relevantIds: string[];
  confidence: number;
  reasoning?: string;
}

export interface IndexScanOptions {
  /** Timeout for the scan HTTP call (default 30s). */
  timeoutMs?: number;
  /** Minimum confidence to include scan results (default 0.3). */
  minConfidence?: number;
}

/** Injectable dependencies for the scan HTTP transport (tests override). */
export interface ScanHttpDeps {
  fetchFn?: typeof fetch;
  /** Explicit endpoint override (default: resolveScanBaseUrl(providerID)). */
  baseUrl?: string;
  /** Explicit API key (default: getProviderApiKey(providerID) via runtime auth). */
  apiKey?: string;
  authPath?: string;
  credentials?: { getApiKey(provider: string): string | null };
  /** Default timeout for scan() when options.timeoutMs is omitted. */
  timeoutMs?: number;
  /** providerID → chat-completions URL (config recall.scanEndpoints). */
  scanEndpoints?: Record<string, string>;
  /** Async endpoint resolution (e.g. opencode provider config baseURL); wins over scanEndpoints, loses to baseUrl. */
  resolveEndpoint?: (providerID: string) => Promise<string | null>;
  /** Async API-key resolution (e.g. opencode provider config options.apiKey); wins over auth.json fallback. */
  resolveApiKey?: (providerID: string) => Promise<string | null>;
  /** Usage sink — direct-HTTP scans produce no opencode events, so the gateway injects a trajectory recorder here. */
  recordUsage?: (u: ScanUsageRecord) => void;
}

/**
 * Map a provider id to its OpenAI-compatible chat-completions endpoint.
 * `endpoints` (config `recall.scanEndpoints`) wins over the hardcoded table;
 * unknown providers resolve to undefined — the caller may still inject an
 * endpoint via ScanHttpDeps.resolveEndpoint (e.g. derived from the opencode
 * provider config) or fall back to BM25-only recall.
 */
export function resolveScanBaseUrl(providerID?: string, endpoints?: Record<string, string>): string | undefined {
  if (!providerID) return undefined;
  const mapped = endpoints?.[providerID];
  if (mapped) return mapped;
  const p = providerID.toLowerCase();
  if (p.includes('alibaba') || p.includes('dashscope') || p.includes('qwen')) {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  }
  return undefined;
}

/** FNV-1a (32-bit) — cheap byte-stability fingerprint for the index text. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ScanUsageRecord {
  providerID?: string;
  modelID?: string;
  /** Uncached prompt tokens (prompt_tokens − cached_tokens). */
  input: number;
  cached: number;
  output: number;
  latencyMs: number;
  /** false when the response arrived but was unparsable/low-confidence. */
  ok: boolean;
  /** Fingerprint of the index text used — attributes cold scans to text changes vs TTL. */
  indexHash: string;
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
 * Format the full harmonic index into a compact text block for scanning.
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
 * Parse the scan response into structured result.
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
 * IndexScanService runs scan queries over direct HTTP and caches the index
 * text. Created once by the gateway, reused across all scan calls.
 */
export class IndexScanService {
  private cachedIndexText: string | null = null;
  private cachedAt: number = 0;
  private lastIndexHash: string | null = null;
  private inFlight: Promise<ScanResult | null> | null = null;
  // Failure cooldown state: a slow or broken worker model must not burn a
  // request on every recall call. Exponential backoff (1/2/4 min, capped);
  // a healthy scan resets the streak. Low-confidence results are healthy
  // "no match" answers and do NOT arm the cooldown.
  private lastFailAt = 0;
  private consecutiveFails = 0;
  private lastAttemptFailed = false;
  // Warn-once flag for unresolvable endpoint/key so a misconfiguration
  // doesn't spam the log on every scan attempt.
  private warnedUnresolvable = false;
  // Async prefetch snapshots: scan results precomputed when a user message
  // arrives, consumed later by the sync recall path (never awaited there).
  private snapshots = new Map<string, { result: ScanResult; at: number }>();
  private lastPrefetchAt = new Map<string, number>();
  private static readonly SNAPSHOT_TTL_MS = 10 * 60_000;
  private static readonly SNAPSHOT_CAP = 64;
  private static readonly PREFETCH_THROTTLE_MS = 60_000;

  constructor(
    private index: HarmonicIndexManager,
    private workerModel?: { providerID: string; modelID: string },
    private deps: ScanHttpDeps = {},
  ) {}

  /** Refresh the cached index text. Called hourly by turn-compress cron. */
  refreshCache(): void {
    const text = formatIndexForScan(this.index);
    const hash = hashText(text);
    const changed = this.lastIndexHash !== null && this.lastIndexHash !== hash;
    log.info(`[IndexScan] cache refreshed: ${text.split('\n').length - 2} entries, ${text.length} chars, hash=${hash}${this.lastIndexHash !== null ? `, changed=${changed}` : ''}`);
    this.cachedIndexText = text;
    this.lastIndexHash = hash;
    this.cachedAt = Date.now();
  }

  /** Get the cached index text, refreshing if needed. */
  getIndexText(): string {
    if (!this.cachedIndexText) {
      this.refreshCache();
    }
    return this.cachedIndexText!;
  }

  /**
   * Run a scan: send cached index + query to the worker model over direct
   * HTTP, parse the response. Returns null on failure (fail-open: callers
   * fall back to BM25 only). Deduplicates concurrent calls — if a scan is
   * already in-flight, returns the same promise.
   */
  async scan(query: string, options: IndexScanOptions = {}): Promise<ScanResult | null> {
    const timeoutMs = options.timeoutMs ?? this.deps.timeoutMs ?? 30_000;
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
    const providerID = this.workerModel?.providerID;
    const modelID = this.workerModel?.modelID;
    const baseUrl = this.deps.baseUrl
      ?? (await this.deps.resolveEndpoint?.(providerID ?? '') ?? undefined)
      ?? resolveScanBaseUrl(providerID, this.deps.scanEndpoints);
    const apiKey = this.deps.apiKey
      ?? (await this.deps.resolveApiKey?.(providerID ?? '') ?? undefined)
      ?? getProviderApiKey(providerID ?? '', this.deps.authPath, this.deps.credentials);
    if (!baseUrl || !apiKey) {
      if (!this.warnedUnresolvable) {
        log.warn(`[IndexScan] no endpoint or API key for provider "${providerID ?? '?'}" — scan disabled`);
        this.warnedUnresolvable = true;
      }
      this.lastAttemptFailed = true;
      return null;
    }

    const startedAt = Date.now();
    const fetchFn = this.deps.fetchFn ?? globalThis.fetch.bind(globalThis);
    try {
      const indexText = this.getIndexText();
      const body = {
        model: modelID,
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: SCAN_SYSTEM },
              // Explicit cache marker: DashScope caches the block from the
              // start of the messages up to here (SCAN_SYSTEM + index) for
              // 5 minutes, reset on every hit → deterministic ~10% input cost.
              { type: 'text', text: indexText, cache_control: { type: 'ephemeral' } },
            ],
          },
          {
            role: 'user',
            content: `User query: ${query}\n\nSelect the most relevant memory entries from the index above.`,
          },
        ],
        temperature: 0,
        // Reasoning models (glm-5.3-flash always thinks, ~300-1500 reasoning
        // tokens) need headroom or the JSON gets truncated mid-stream
        // (finish_reason=length → unparsable → cooldown). The JSON itself is
        // ~100 tokens; 4096 covers the reasoning budget with margin.
        max_tokens: 4096,
      };

      const resp = await Promise.race([
        fetchFn(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('scan timeout')), timeoutMs);
          timer.unref?.();
        }),
      ]) as any;

      if (!resp?.ok) {
        const text = await resp?.text?.().catch(() => '') ?? '';
        log.warn(`[IndexScan] scan failed: HTTP ${resp?.status}: ${String(text).slice(0, 200)}`);
        this.lastAttemptFailed = true;
        return null;
      }

      const json = await resp.json();
      const message = json?.choices?.[0]?.message;
      let content = typeof message?.content === 'string' ? message.content : '';
      // Reasoning models may put the answer in reasoning_content when content
      // is empty (e.g. max_tokens cut reasoning short).
      if (!content.trim() && typeof message?.reasoning_content === 'string') {
        content = message.reasoning_content;
      }
      const usage = json?.usage;
      const cachedTokens = usage?.prompt_tokens_details?.cached_tokens;
      const result = parseScanResponse(content);

      // Self-record usage: direct-HTTP scans bypass opencode, so without this
      // sink the memory-system token stats silently lose the scan's share.
      if (this.deps.recordUsage && usage) {
        try {
          this.deps.recordUsage({
            providerID,
            modelID,
            input: Math.max(0, (usage.prompt_tokens || 0) - (cachedTokens || 0)),
            cached: cachedTokens || 0,
            output: usage.completion_tokens || 0,
            latencyMs: Date.now() - startedAt,
            ok: result != null,
            indexHash: hashText(this.getIndexText()),
          });
        } catch { /* never block the scan path on recorder errors */ }
      }

      if (!result) {
        this.lastAttemptFailed = true; // unparsable output — model likely broken
        const finish = json?.choices?.[0]?.finish_reason;
        log.warn(`[IndexScan] scan failed: unparsable response (finish=${finish ?? '?'}, ${Date.now() - startedAt}ms)`);
        return null;
      }

      // Resolve short IDs to full IDs
      result.relevantIds = resolveShortIds(result.relevantIds, this.index);

      const elapsed = Date.now() - startedAt;
      if (result.confidence < minConfidence) {
        log.info(`[IndexScan] ok: low confidence ${result.confidence} < ${minConfidence}, discarding (${elapsed}ms${cachedTokens != null ? `, cachedTokens=${cachedTokens}` : ''})`);
        this.lastAttemptFailed = false; // healthy "no match"
        return null;
      }

      this.lastAttemptFailed = false;
      log.info(`[IndexScan] ok: ids=${result.relevantIds.length} confidence=${result.confidence} (${elapsed}ms${cachedTokens != null ? `, cachedTokens=${cachedTokens}` : ''})`);
      return result;
    } catch (err: any) {
      log.warn(`[IndexScan] scan failed: ${err.message}`);
      this.lastAttemptFailed = true;
      return null;
    }
  }

  /**
   * Fire-and-forget prefetch: scan the query now and store the result as a
   * per-session snapshot for later sync-path consumption. Throttled per
   * session (60s); scan-internal dedup/cooldown still apply.
   */
  prefetch(sessionID: string, query: string): void {
    if (!sessionID || !query.trim()) return;
    const now = Date.now();
    const last = this.lastPrefetchAt.get(sessionID) ?? 0;
    if (now - last < IndexScanService.PREFETCH_THROTTLE_MS) return;
    this.lastPrefetchAt.set(sessionID, now);
    void this.scan(query)
      .then((result) => {
        if (result) this.setSnapshot(sessionID, result);
      })
      .catch(() => {});
  }

  private setSnapshot(sessionID: string, result: ScanResult): void {
    if (this.snapshots.size >= IndexScanService.SNAPSHOT_CAP && !this.snapshots.has(sessionID)) {
      // Evict the oldest snapshot when at capacity.
      let oldestKey = '';
      let oldestAt = Infinity;
      for (const [k, v] of this.snapshots) {
        if (v.at < oldestAt) {
          oldestAt = v.at;
          oldestKey = k;
        }
      }
      if (oldestKey) this.snapshots.delete(oldestKey);
    }
    this.snapshots.set(sessionID, { result, at: Date.now() });
  }

  /**
   * Latest precomputed scan snapshot for a session. The sync recall path
   * merges this in-memory and never awaits a scan. Snapshots expire after
   * 10 minutes.
   */
  getSnapshot(sessionID: string): ScanResult | null {
    const snap = this.snapshots.get(sessionID);
    if (!snap) return null;
    if (Date.now() - snap.at > IndexScanService.SNAPSHOT_TTL_MS) {
      this.snapshots.delete(sessionID);
      return null;
    }
    return snap.result;
  }

  /** No long-lived resources to dispose (direct HTTP, no sessions). */
  async dispose(): Promise<void> {}
}
