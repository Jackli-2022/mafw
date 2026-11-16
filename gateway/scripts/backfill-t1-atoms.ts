/**
 * One-off T1 turn-code + atom backfill against the real gateway DB.
 *
 * Run from gateway/:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/backfill-t1-atoms.ts --limit 5000
 *
 * Opens its own llama.cpp embedding sidecar through the normal provider factory,
 * so the dynamic port is resolved exactly like the gateway does.
 */
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { getT1SemanticEncoder } from '../src/recall/t1-semantic-atoms';
import { backfillT1Atoms } from '../src/recall/t1-atom-backfill';
import { rebuildSessionEpisodes } from '../src/recall/t1-episode-rebuild';

function argNumber(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

async function main() {
  const totalLimit = argNumber('--limit', 5000);
  const passLimit = argNumber('--batch', 128);
  const dbPath = path.join(config.resolvePath('memory'), 'gateway.db');
  const db = new GatewayDatabase(dbPath);
  let runtime: ReturnType<typeof initEmbeddingRuntime> = null;
  try {
    runtime = initEmbeddingRuntime({
      baseDir: config.resolvePath(),
      cfg: config.memory.embedding,
      vectorDb: db.getStore(),
    });
    if (!runtime?.provider) {
      console.error('embedding runtime unavailable; cannot encode atoms');
      process.exitCode = 1;
      return;
    }
    const encoder = getT1SemanticEncoder(runtime.provider, {
      referenceTexts: () => db.sampleTurnTexts(24),
    });

    let remaining = totalLimit;
    let pass = 0;
    let encoded = 0;
    let failed = 0;
    while (remaining > 0) {
      const result = await backfillT1Atoms(
        db,
        (turns) => encoder.encodeMany(turns),
        { limit: Math.min(passLimit, remaining) },
      );
      if (result.scanned === 0) break;
      for (const sessionId of result.sessionIds) {
        try {
          rebuildSessionEpisodes(db, sessionId, { now: Date.now() });
        } catch { /* fail-open */ }
      }
      encoded += result.encoded;
      failed += result.failed;
      remaining -= result.scanned;
      pass++;
      console.log(
        JSON.stringify({
          pass,
          scanned: result.scanned,
          encoded: result.encoded,
          failed: result.failed,
          sessions: result.sessionIds.length,
        }),
      );
    }

    const stats = db.t1CodeStats();
    const calibration = encoder.calibrationSnapshot;
    console.log(
      JSON.stringify({
        done: true,
        passes: pass,
        encoded,
        failed,
        code: stats,
        calibration: calibration
          ? { anchors: calibration.anchors, referenceCount: calibration.referenceCount }
          : null,
      }),
    );
  } finally {
    try {
      await runtime?.provider.dispose?.();
    } catch { /* ignore */ }
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
