// T1 episode encode: one turn's sparse code, written after the turn completes.
//
// This is the "hippocampal encoding" stage rather than the raw capture stage:
// raw observations are appended synchronously and never blocked, while this
// pass joins trajectory metadata (who acted), extracts the feature code, maps
// concepts, and writes the sparse term index. Everything is derived and
// rebuildable; failure is fail-open at the caller.
import type { GatewayDatabase, T1Observation, T1Turn, T1TurnFeature } from '../memory/gateway-db';
import { extractTurnFeature } from './t1-features';
import {
  extractTurnActors,
  type T1ActorEvent,
  type T1TurnActor,
} from './t1-actors';
import { extractTurnConcepts, type T1TurnConcept } from './t1-concepts';
import {
  encodeTurnSparseTerms,
  type T1SparseAtom,
  type T1SparseTerm,
} from './t1-sparse';

export interface T1EncodingMarker {
  traceId: string;
  model: string;
  actorCount: number;
  conceptCount: number;
  sparseCount: number;
}

export interface T1EncodeDeps {
  readTurnRows(sessionId: string, turnSeq: number): T1Observation[];
  readTrajectoryEvents?(sessionId: string, turnSeq: number): T1ActorEvent[];
  upsertTurnActors(traceId: string, actors: T1TurnActor[]): void;
  upsertTurnConcepts(traceId: string, concepts: T1TurnConcept[]): void;
  upsertSparseTerms(traceId: string, terms: T1SparseTerm[]): void;
  upsertTurnEncoding(marker: T1EncodingMarker): void;
}

export interface T1EncodeResult {
  traceId: string;
  actors: number;
  concepts: number;
  sparse: number;
  model: string;
}

export interface T1EncodeOptions {
  /** Reuse a feature already extracted by the caller (avoids double work). */
  feature?: T1TurnFeature | null;
  /** Optional embedding-derived semantic atoms. */
  atoms?: T1SparseAtom[];
  projectId?: string;
  userActorId?: string;
}

/**
 * Encode one turn and persist actor / concept / sparse rows plus a completion
 * marker. The marker is what makes backfill idempotent even when a turn has no
 * actors or matched concepts.
 */
export function encodeT1Turn(
  turn: Pick<T1Turn, 'trace_id' | 'session_id' | 'turn_seq'>,
  deps: T1EncodeDeps,
  opts: T1EncodeOptions = {},
): T1EncodeResult {
  const rows = deps.readTurnRows(turn.session_id, turn.turn_seq);
  const feature =
    opts.feature !== undefined ? opts.feature : extractTurnFeature(turn, rows);

  const actors = extractTurnActors(
    turn,
    rows,
    deps.readTrajectoryEvents?.(turn.session_id, turn.turn_seq) ?? [],
    { projectId: opts.projectId, userActorId: opts.userActorId },
  );
  const concepts = extractTurnConcepts(turn, rows, feature);
  const sparse = encodeTurnSparseTerms({
    turn,
    rows,
    feature,
    concepts,
    actors,
    atoms: opts.atoms,
  });
  const model = sparse[0]?.model ?? 'sparse-lex-v1';

  deps.upsertTurnActors(turn.trace_id, actors);
  deps.upsertTurnConcepts(turn.trace_id, concepts);
  deps.upsertSparseTerms(turn.trace_id, sparse);
  deps.upsertTurnEncoding({
    traceId: turn.trace_id,
    model,
    actorCount: actors.length,
    conceptCount: concepts.length,
    sparseCount: sparse.length,
  });

  return {
    traceId: turn.trace_id,
    actors: actors.length,
    concepts: concepts.length,
    sparse: sparse.length,
    model,
  };
}

export interface T1EncodeBackfillResult {
  scanned: number;
  written: number;
  failed: number;
}

/**
 * One bounded backfill pass over turns that have no encoding marker. Repeat
 * until `scanned === 0`; the marker guarantees forward progress even for turns
 * whose actor/concept sets are empty.
 */
export function backfillT1Encoding(
  db: GatewayDatabase,
  opts: { limit?: number; projectId?: string } = {},
): T1EncodeBackfillResult {
  const result: T1EncodeBackfillResult = { scanned: 0, written: 0, failed: 0 };
  const limit = Math.max(0, Math.trunc(opts.limit ?? 500));
  if (limit === 0) return result;

  const turns = db.listTurnsMissingEncoding(limit);
  const deps: T1EncodeDeps = {
    readTurnRows: (sessionId, turnSeq) => db.readTurnRows(sessionId, turnSeq),
    readTrajectoryEvents: (sessionId, turnSeq) =>
      db.readTrajectoryEvents(sessionId, turnSeq),
    upsertTurnActors: (traceId, actors) => db.upsertTurnActors(traceId, actors),
    upsertTurnConcepts: (traceId, concepts) => db.upsertTurnConcepts(traceId, concepts),
    upsertSparseTerms: (traceId, terms) => db.upsertSparseTerms(traceId, terms),
    upsertTurnEncoding: (marker) => db.upsertTurnEncoding(marker),
  };

  for (const turn of turns) {
    result.scanned++;
    try {
      encodeT1Turn(turn, deps, { projectId: opts.projectId });
      result.written++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
