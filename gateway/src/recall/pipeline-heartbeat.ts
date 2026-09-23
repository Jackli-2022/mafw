// Pipeline heartbeat — "no enumerated failure mode may pass unrecorded"
// (arXiv:2609.05510, Memory as Infrastructure).
//
// Background pipelines (decay / turnCompress / reflect / stale-verify) fail
// silently by default: the cron ledger records that a rule TRIGGERED, never
// whether it did anything. The 2026-09 decay freeze and consolidation idle were
// exactly this class. Each pipeline records last-run / last-success / counts;
// a pipeline that stops producing successes past 2× its interval is flagged
// stale and warned once per episode.

export interface PipelineRunRecord {
  name: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastCounts?: Record<string, number>;
  ok?: boolean;
  error?: string;
}

/** Persistence seam — wired to gateway.db kv_store in production. */
export interface HeartbeatKv {
  get(name: string): PipelineRunRecord | null;
  set(name: string, record: PipelineRunRecord): void;
}

export interface HeartbeatSnapshot extends PipelineRunRecord {
  intervalMs: number | null;
  /** ms since the last success (or last run when it never succeeded). */
  ageMs: number | null;
  stale: boolean;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const DEFAULT_PIPELINE_INTERVALS_MS: Record<string, number> = {
  'memory:decay': DAY,
  'memory:turnCompress': HOUR,
  'memory:reflect': HOUR,
  'memory:review': 7 * DAY,
  consolidation: 7 * DAY,
};

export interface PipelineHeartbeatOpts {
  now?: () => number;
  intervals?: Record<string, number>;
  onWarn?: (message: string) => void;
}

export class PipelineHeartbeat {
  private kv: HeartbeatKv;
  private now: () => number;
  private intervals: Record<string, number>;
  private onWarn: (message: string) => void;
  private warned = new Set<string>();

  constructor(kv: HeartbeatKv, opts: PipelineHeartbeatOpts = {}) {
    this.kv = kv;
    this.now = opts.now ?? (() => Date.now());
    this.intervals = opts.intervals ?? DEFAULT_PIPELINE_INTERVALS_MS;
    this.onWarn = opts.onWarn ?? (() => { /* no-op */ });
  }

  record(name: string, result: { ok: boolean; counts?: Record<string, number>; error?: string }): void {
    const nowIso = new Date(this.now()).toISOString();
    const prev = this.kv.get(name);
    this.kv.set(name, {
      name,
      lastRunAt: nowIso,
      lastSuccessAt: result.ok ? nowIso : prev?.lastSuccessAt,
      lastCounts: result.counts ?? prev?.lastCounts,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    if (result.ok) this.warned.delete(name);
  }

  snapshot(names?: string[]): HeartbeatSnapshot[] {
    const list = names ?? Object.keys(this.intervals);
    const now = this.now();
    return list.map((name) => {
      const rec = this.kv.get(name) ?? { name };
      const intervalMs = this.intervals[name] ?? null;
      const reference = rec.lastSuccessAt ?? rec.lastRunAt;
      const ageMs = reference ? now - Date.parse(reference) : null;
      // Never-run pipelines are not stale (avoids startup false alarms); a run
      // that never succeeded ages from lastRunAt.
      const stale = intervalMs != null && ageMs != null && ageMs > 2 * intervalMs;
      return { ...rec, intervalMs, ageMs, stale };
    });
  }

  /** Warn (once per episode) for every stale pipeline; returns newly-warned names. */
  sweep(names?: string[]): string[] {
    const newlyStale: string[] = [];
    for (const snap of this.snapshot(names)) {
      if (!snap.stale || this.warned.has(snap.name)) continue;
      this.warned.add(snap.name);
      newlyStale.push(snap.name);
      const ageH = snap.ageMs != null ? Math.round(snap.ageMs / HOUR) : '?';
      this.onWarn(
        `[Heartbeat] pipeline "${snap.name}" stale: no success for ~${ageH}h ` +
          `(interval ${Math.round((snap.intervalMs ?? 0) / HOUR)}h, lastRun=${snap.lastRunAt ?? 'never'})`,
      );
    }
    return newlyStale;
  }
}
