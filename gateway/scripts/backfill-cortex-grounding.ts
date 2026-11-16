/**
 * One-off cortical grounding backfill.
 *
 * Dry-run (default):
 *   npx ts-node --transpile-only --project tsconfig.json scripts/backfill-cortex-grounding.ts
 * Apply:
 *   ... --apply
 *
 * Only units with exact `source_trace_ids` are touched. Units without traces
 * are reported as `ungrounded`; no session/time guessing.
 */
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { HarmonicUnitFileStore } from '../src/memory/harmonic-file-store';
import { planCortexGrounding } from '../src/memory/cortex-grounding';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = new GatewayDatabase(path.join(config.resolvePath('memory'), 'gateway.db'));
  const store = new HarmonicUnitFileStore(config.resolvePath());
  try {
    const entries = store.indexManager_().getIndex().entries;
    const plan = planCortexGrounding(entries, {
      findEpisodeByTrace: (traceId) => db.findEpisodeByTrace(traceId),
    });

    let applied = 0;
    const failed: string[] = [];
    if (apply) {
      for (const update of plan.updates) {
        try {
          const unit = await store.read(update.id);
          if (!unit) {
            failed.push(update.id);
            continue;
          }
          await store.write({ ...unit, episode_id: update.episodeId });
          applied++;
        } catch {
          failed.push(update.id);
        }
      }
    }

    console.log(
      JSON.stringify({
        dryRun: !apply,
        total: entries.length,
        candidates: plan.updates.length + plan.unresolved.length,
        resolved: plan.updates.length,
        unresolved: plan.unresolved.length,
        ungrounded: plan.ungrounded,
        applied,
        failed: failed.length,
        failedIds: failed.slice(0, 10),
      }),
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
