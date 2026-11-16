/**
 * Shadow backfill for session-based episode hints.
 *
 * Dry-run (default):
 *   npx ts-node --transpile-only --project tsconfig.json scripts/backfill-cortex-hints.ts
 * Apply:
 *   ... --apply
 *
 * Hints never touch the exact `episode_id`; they are stored as
 * `episode_hint { episodeId, basis, confidence }` for later evaluation.
 */
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { HarmonicUnitFileStore } from '../src/memory/harmonic-file-store';
import {
  planEpisodeHints,
  type HintEntry,
  type HintEpisode,
} from '../src/memory/cortex-grounding';

async function main() {
  const apply = process.argv.includes('--apply');
  const reset = process.argv.includes('--reset');
  const db = new GatewayDatabase(path.join(config.resolvePath('memory'), 'gateway.db'));
  const store = new HarmonicUnitFileStore(config.resolvePath());
  try {
    if (reset && apply) {
      let removed = 0;
      for (const entry of store.indexManager_().getIndex().entries.filter((item) => item.episode_hint)) {
        try {
          const unit = await store.read(entry.id);
          if (!unit) continue;
          await store.write({ ...unit, episode_hint: undefined }, undefined, { save: false });
          removed++;
          if (removed % 500 === 0) store.indexManager_().save();
        } catch { /* per-unit fail-open */ }
      }
      store.indexManager_().save();
      console.log(JSON.stringify({ reset: true, removed }));
    }

    const entries = store.indexManager_().getIndex().entries as unknown as HintEntry[];
    const sessions = new Set<string>();
    for (const entry of entries) {
      if (entry.episode_id || entry.episode_hint) continue;
      if (entry.source_session_id) sessions.add(entry.source_session_id);
    }

    const episodesBySession = new Map<string, HintEpisode[]>();
    for (const sessionId of sessions) {
      const page = db.listEpisodes({ sessionId, limit: 1000 });
      episodesBySession.set(
        sessionId,
        page.episodes.map((episode) => ({
          episodeId: episode.episodeId,
          endedAt: episode.endedAt,
          intent: episode.intent,
        })),
      );
    }

    const plan = planEpisodeHints(entries, episodesBySession);
    let applied = 0;
    let failed = 0;
    if (apply) {
      for (const update of plan.updates) {
        try {
          const unit = await store.read(update.id);
          if (!unit) {
            failed++;
            continue;
          }
          await store.write(
            { ...unit, episode_hint: update.hint },
            undefined,
            { save: false },
          );
          applied++;
          if (applied % 500 === 0) store.indexManager_().save();
        } catch {
          failed++;
        }
      }
      store.indexManager_().save();
    }

    console.log(
      JSON.stringify({
        dryRun: !apply,
        total: entries.length,
        sessions: sessions.size,
        candidates: plan.updates.length,
        skippedExisting: plan.skippedExisting,
        noSession: plan.noSession,
        noEpisode: plan.noEpisode,
        ambiguous: plan.ambiguous,
        unusable: plan.unusable,
        applied,
        failed,
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
