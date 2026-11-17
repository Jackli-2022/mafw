/**
 * One-off backfill for encode-time replay signals (E2).
 *
 * Dry-run (default):
 *   npx ts-node --transpile-only --project tsconfig.json scripts/backfill-t1-signals.ts
 * Apply:
 *   ... --apply
 *
 * Uses the real cortex vector store as the reference set; memories created
 * after a turn are excluded, so the score reflects what was knowable then.
 */
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { HarmonicUnitFileStore } from '../src/memory/harmonic-file-store';
import {
  computeTurnSignals,
  computeTurnSurprise,
  isInformativeTurn,
  normalizeObservationText,
  unitLookupFromEntries,
  type SurpriseInput,
  type TurnSignalInput,
} from '../src/recall/t1-signals';

interface Row {
  trace_id: string;
  session_id: string;
  turn_seq: number;
  intent: string | null;
  entities_json: string | null;
  tool: string | null;
  target: string | null;
  last_ts: number | null;
}

function turnLastTs(observations: Array<{ created_at?: number }>): number | undefined {
  let max = 0;
  for (const row of observations) max = Math.max(max, Number(row.created_at ?? 0));
  return max > 0 ? max : undefined;
}

function percentiles(values: number[]): { p50: number; p90: number; p99: number; max: number } {
  if (values.length === 0) return { p50: 0, p90: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99), max: sorted[sorted.length - 1] };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reset = process.argv.includes('--reset');
  const db = new GatewayDatabase(path.join(config.resolvePath('memory'), 'gateway.db'));
  let runtime: ReturnType<typeof initEmbeddingRuntime> = null;
  try {
    runtime = initEmbeddingRuntime({
      baseDir: config.resolvePath(),
      cfg: config.memory.embedding,
      vectorDb: db.getStore(),
    });
    if (!runtime?.provider) {
      console.error('embedding runtime unavailable; cannot score signals');
      process.exitCode = 1;
      return;
    }

    const store = new HarmonicUnitFileStore(config.resolvePath());
    const unitFor = unitLookupFromEntries(
      store.indexManager_().getIndex().entries,
    );

    if (reset && apply) {
      db.getStore().prepare('UPDATE t1_turn_features SET novelty = NULL, mismatch = NULL').run();
      process.stderr.write('[signals] reset previous scores\n');
    }

    const rows = db
      .getStore()
      .prepare(
        `SELECT f.trace_id, f.session_id, f.turn_seq, f.intent, f.entities_json,
                f.tool, f.target
           FROM t1_turn_features f
          ORDER BY f.turn_seq`,
      )
      .all() as Row[];

    const inputs: TurnSignalInput[] = [];
    const surpriseInputs: SurpriseInput[] = [];
    for (const row of rows) {
      // Archived turns only resolve through readTrace (active + archive).
      const trace = db.readTrace(row.trace_id);
      const observations = trace?.rows ?? [];
      const text = normalizeObservationText(observations);
      if (!text.trim()) continue;
      let entities: string[] = [];
      try {
        entities = row.entities_json ? JSON.parse(row.entities_json) : [];
      } catch {
        entities = [];
      }
      inputs.push({
        traceId: row.trace_id,
        text,
        cue: [row.intent, ...entities, row.tool, row.target].filter(Boolean).join(' '),
        intent: row.intent ?? '',
        lastTs: turnLastTs(observations as Array<{ created_at?: number }>),
        anchorCount: entities.length,
      });
      const prevTrace = db.getPrevTurnTrace(row.session_id, row.turn_seq);
      if (prevTrace) {
        const prev = db.readTrace(prevTrace);
        const prevText = prev?.rows ? normalizeObservationText(prev.rows) : '';
        if (prevText.trim()) {
          surpriseInputs.push({ traceId: row.trace_id, text, prevText });
        }
      }
    }

    const scores = new Map<string, { novelty: number; mismatch: number }>();
    const surpriseScores = new Map<string, number>();
    let failed = 0;
    process.stderr.write(`[signals] features=${rows.length} eligible=${inputs.length} surprise=${surpriseInputs.length} model=${runtime.providerId}\n`);
    for (let i = 0; i < inputs.length; i += 32) {
      const batch = inputs.slice(i, i + 32);
      try {
        const batchScores = await computeTurnSignals(batch, {
          embedder: runtime.provider,
          vectors: runtime.vectors,
          unitFor,
        });
        for (const [traceId, signals] of batchScores) scores.set(traceId, signals);
      } catch {
        failed += batch.length;
      }
      if (i % 320 === 0) process.stderr.write(`[signals] ${i}/${inputs.length}\n`);
    }

    for (let i = 0; i < surpriseInputs.length; i += 32) {
      const batch = surpriseInputs.slice(i, i + 32);
      try {
        const batchScores = await computeTurnSurprise(batch, { embedder: runtime.provider });
        for (const [traceId, value] of batchScores) surpriseScores.set(traceId, value);
      } catch {
        failed += batch.length;
      }
    }

    const noveltyValues = [...scores.values()].map((s) => s.novelty);
    const mismatchValues = [...scores.values()].map((s) => s.mismatch);
    const surpriseValues = [...surpriseScores.values()];
    let applied = 0;
    let writeFailed = 0;
    if (apply) {
      for (const [traceId, signals] of scores) {
        try {
          const feature = db.getTurnFeature(traceId);
          if (!feature) {
            writeFailed++;
            continue;
          }
          db.upsertTurnFeature({
            ...feature,
            novelty: signals.novelty,
            mismatch: signals.mismatch,
            surprise: surpriseScores.get(traceId),
          });
          applied++;
        } catch {
          writeFailed++;
        }
      }
    }

    const noveltyMap = new Map([...scores].map(([id, s]) => [id, s.novelty]));
    const mismatchMap = new Map([...scores].map(([id, s]) => [id, s.mismatch]));
    const aucFor = (values: Map<string, number>, positives: Set<string>) => {
      const pos: number[] = [];
      const neg: number[] = [];
      for (const [id, value] of values) (positives.has(id) ? pos : neg).push(value);
      if (pos.length === 0 || neg.length === 0) return null;
      let wins = 0;
      for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
      return +(wins / (pos.length * neg.length)).toFixed(3);
    };
    const activeTraces = new Set<string>();
    for (const entry of store.indexManager_().getIndex().entries) {
      if (entry.superseded_by) continue;
      for (const trace of (entry as any).source_trace_ids ?? []) activeTraces.add(trace);
    }
    const retrieved = new Set<string>(
      (db.getStore().prepare('SELECT DISTINCT trace_id FROM t1_retrieval_events WHERE trace_id IS NOT NULL').all() as Array<{ trace_id: string }>).map((r) => r.trace_id),
    );
    const labelB = new Set([...activeTraces].filter((trace) => retrieved.has(trace)));
    const comparison = {
      labelA: {
        positives: [...activeTraces].filter((trace) => noveltyMap.has(trace) || surpriseScores.has(trace)).length,
        novelty: aucFor(noveltyMap, activeTraces),
        mismatch: aucFor(mismatchMap, activeTraces),
        surprise: aucFor(surpriseScores, activeTraces),
      },
      labelB: {
        positives: [...labelB].filter((trace) => noveltyMap.has(trace) || surpriseScores.has(trace)).length,
        novelty: aucFor(noveltyMap, labelB),
        mismatch: aucFor(mismatchMap, labelB),
        surprise: aucFor(surpriseScores, labelB),
      },
    };

    console.log(
      JSON.stringify({
        dryRun: !apply,
        model: runtime.providerId,
        features: rows.length,
        eligible: inputs.length,
        informative: inputs.filter((input) => isInformativeTurn(input.text, input.anchorCount)).length,
        scored: scores.size,
        surpriseScored: surpriseScores.size,
        failed,
        applied,
        writeFailed,
        novelty: percentiles(noveltyValues),
        mismatch: percentiles(mismatchValues),
        surprise: percentiles(surpriseValues),
        comparison,
      }),
    );
    // The provider may keep a sidecar handle alive; this is a one-shot script.
    process.exit(0);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
