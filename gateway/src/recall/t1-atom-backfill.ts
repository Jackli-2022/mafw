// Bounded, idempotent T1 turn-code backfill.
//
// The live write path encodes a turn only after its session goes stale, so a
// database that predates the encoding pipeline has no features/actors/concepts/
// sparse code for its history. This pass pages through turns with no encoding
// marker and reuses `encodeT1Turn`, which is the same code the live pipeline
// runs — lexical terms are recomputed, atoms are added, nothing is hand-built.
import { encodeT1Turn, type T1EncodeDeps } from './t1-encode';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { T1SparseAtom } from './t1-sparse';

export interface T1AtomBackfillResult {
  scanned: number;
  encoded: number;
  failed: number;
  sessionIds: string[];
}

/**
 * One bounded pass. A turn that legitimately produces zero atoms still gets a
 * `sparse-embed-v1` marker, so it is not re-scanned forever.
 */
export async function backfillT1Atoms(
  db: GatewayDatabase,
  encodeAtoms: (
    turns: Array<{ traceId: string; text: string }>,
  ) => Promise<Map<string, T1SparseAtom[]>>,
  opts: { limit?: number; batchSize?: number } = {},
): Promise<T1AtomBackfillResult> {
  const limit = Math.max(0, Math.trunc(opts.limit ?? 128));
  const batchSize = Math.max(1, Math.trunc(opts.batchSize ?? 16));
  const result: T1AtomBackfillResult = {
    scanned: 0,
    encoded: 0,
    failed: 0,
    sessionIds: [],
  };
  if (limit === 0) return result;

  const turns = db.listTurnsMissingTurnCode(limit);
  result.scanned = turns.length;
  if (turns.length === 0) return result;

  const deps: T1EncodeDeps = {
    readTurnRows: (sessionId, turnSeq) => db.readTurnRows(sessionId, turnSeq),
    readTrajectoryEvents: (sessionId, turnSeq) =>
      db.readTrajectoryEvents(sessionId, turnSeq),
    upsertTurnFeature: (feature) => db.upsertTurnFeature(feature),
    upsertTurnActors: (traceId, actors) => db.upsertTurnActors(traceId, actors),
    upsertTurnConcepts: (traceId, concepts) =>
      db.upsertTurnConcepts(traceId, concepts),
    upsertSparseTerms: (traceId, terms) => db.upsertSparseTerms(traceId, terms),
    upsertTurnEncoding: (marker) => db.upsertTurnEncoding(marker),
  };

  const sessions = new Set<string>();
  for (let offset = 0; offset < turns.length; offset += batchSize) {
    const batch = turns.slice(offset, offset + batchSize);
    const inputs = batch
      .map((turn) => {
        const rows = db.readTurnRows(turn.session_id, turn.turn_seq);
        return {
          traceId: turn.trace_id,
          text: rows
            .map((row) => String(row.content ?? ''))
            .join('\n')
            .trim()
            .slice(0, 2000),
        };
      })
      .filter((turn) => turn.text.length > 0);

    let atomsByTrace = new Map<string, T1SparseAtom[]>();
    if (inputs.length > 0) {
      try {
        atomsByTrace = await encodeAtoms(inputs);
      } catch {
        /* fail-open: per-turn lexical code still lands */
      }
    }

    for (const turn of batch) {
      try {
        encodeT1Turn(turn, deps, {
          atoms: atomsByTrace.get(turn.trace_id) ?? [],
          atomsAttempted: true,
        });
        result.encoded++;
        sessions.add(turn.session_id);
      } catch {
        result.failed++;
      }
    }
  }

  result.sessionIds = [...sessions];
  return result;
}
