// FOK hit-proxy labeling: an injected <recall> pointer that the agent later
// redeems via mafw_get_memory is "hit" evidence for that injection's
// top1prob — a continuous label-free labeling loop feeding the A4 isotonic
// calibration (scripts/fok-calibrate.ts --log).
//
// Event log: ~/.mafw/logs/fok-samples.jsonl, append-only, two line shapes:
//   {"e":"inj","ts":<ms>,"top1prob":<0..1>,"zone":"inject|...","ids":[...]}
//   {"e":"rdm","ts":<ms>,"id":"<memory id>"}
//
// Only probability-gated injections (snapshot path, reranker top1prob) are
// logged — the live path's BM25-ratio gate is a different feature family and
// is deliberately excluded from this calibration.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from '../core/utils/logger';

export type FokEvent =
  | { e: 'inj'; ts: number; top1prob: number; zone: string; ids: string[] }
  | { e: 'rdm'; ts: number; id: string };

export const FOK_SAMPLES_FILE = (): string =>
  path.join(os.homedir(), '.mafw', 'logs', 'fok-samples.jsonl');

/** Fail-open append (creates dirs; never throws into the retrieval path). */
export function appendFokEvent(event: FokEvent, file: string = FOK_SAMPLES_FILE()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf-8');
  } catch (err: any) {
    log.warn?.(`[FokSamples] append failed: ${err?.message || err}`);
  }
}

export interface JoinOptions {
  /** Redemption window after an injection (default 10 min). */
  ttlMs?: number;
}

export interface FokLabeledSample {
  top1prob: number;
  hit: boolean;
}

/**
 * Join injections with redemptions: an inj is a hit when some rdm matches one
 * of its ids within [ts, ts + ttl). Pure function over raw log lines —
 * malformed lines and injections without top1prob are skipped.
 */
export function joinFokSamples(lines: string[], opts: JoinOptions = {}): FokLabeledSample[] {
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const injections: Array<{ ts: number; top1prob: number; ids: string[] }> = [];
  const redemptions: Array<{ ts: number; id: string }> = [];
  for (const line of lines ?? []) {
    try {
      const j = JSON.parse(line);
      if (j?.e === 'inj' && Number.isFinite(j.top1prob) && Array.isArray(j.ids)) {
        injections.push({ ts: j.ts, top1prob: j.top1prob, ids: j.ids.filter((x: any) => typeof x === 'string') });
      } else if (j?.e === 'rdm' && typeof j.id === 'string' && Number.isFinite(j.ts)) {
        redemptions.push({ ts: j.ts, id: j.id });
      }
    } catch { /* skip malformed */ }
  }
  return injections.map((inj) => ({
    top1prob: inj.top1prob,
    hit: redemptions.some((r) => r.ts >= inj.ts && r.ts <= inj.ts + ttl && inj.ids.includes(r.id)),
  }));
}

export interface FokSampleStats {
  /** Total injection events (incl. those without top1prob). */
  injections: number;
  /** Total redemption events. */
  redemptions: number;
  /** Joinable calibration samples (injections WITH top1prob). */
  samples: number;
  /** hits / samples; null when no samples yet. */
  hitRate: number | null;
}

/** Observability counters over the raw event log (10s-cached by the caller). */
export function fokSampleStats(lines: string[]): FokSampleStats {
  let injections = 0;
  let redemptions = 0;
  const joinable: string[] = [];
  for (const line of lines ?? []) {
    try {
      const j = JSON.parse(line);
      if (j?.e === 'inj') {
        injections++;
        if (Number.isFinite(j.top1prob) && Array.isArray(j.ids)) joinable.push(line);
      } else if (j?.e === 'rdm') {
        redemptions++;
        joinable.push(line); // the join needs the redemption events too
      }
    } catch { /* skip malformed */ }
  }
  const samples = joinFokSamples(joinable);
  const hits = samples.filter((s) => s.hit).length;
  return {
    injections,
    redemptions,
    samples: samples.length,
    hitRate: samples.length > 0 ? hits / samples.length : null,
  };
}
