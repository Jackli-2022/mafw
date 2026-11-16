// Session-level episode rebuild. Episodes are derived from turn code +
// append-only boundary declarations; this module never touches raw T1.
import { config } from '../config';
import type { GatewayDatabase } from '../memory/gateway-db';
import { computeEpisodeRanges, type EpisodeTurnInput } from './t1-episode-boundary';
import {
  episodeIdFor,
  type T1EpisodeMember,
  type T1EpisodeRecord,
} from './t1-episodes';
import * as fs from 'fs';
import * as path from 'path';

export type EpisodeTurnRow = EpisodeTurnInput;

export function readSessionEpisodeTurns(
  db: GatewayDatabase,
  sessionId: string,
): EpisodeTurnRow[] {
  return db.readSessionEpisodeTurns(sessionId);
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))];
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value && value.trim()));
}

function lastNonEmpty(values: Array<string | undefined>): string | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value && value.trim()) return value;
  }
  return undefined;
}

/**
 * Rebuild every episode for one session and replace the derived rows.
 * Returns null when the session has no turns. Idempotent: the same input and
 * boundaries produce the same episode ids and members.
 */
export function rebuildSessionEpisodes(
  db: GatewayDatabase,
  sessionId: string,
  opts: {
    maxTurns?: number;
    idleCloseMs?: number;
    now?: number;
    sessionDeleted?: boolean;
    /** Shadow-mode observation sink; one JSON line per derived episode. */
    shadowLogPath?: string;
  } = {},
): { episodes: T1EpisodeRecord[]; members: T1EpisodeMember[] } | null {
  const turns = readSessionEpisodeTurns(db, sessionId);
  if (turns.length === 0) return null;

  const cfg = config.recall.t1Episodes;
  const ranges = computeEpisodeRanges({
    sessionId,
    turns,
    boundaries: db.listEpisodeBoundaries(sessionId),
    maxTurns: opts.maxTurns ?? cfg.maxTurns,
    idleCloseMs: opts.idleCloseMs ?? cfg.idleCloseMs,
    timeGapWeakMs: cfg.timeGapWeakMs,
    now: opts.now ?? Date.now(),
    sessionDeleted: opts.sessionDeleted,
  });

  const episodes: T1EpisodeRecord[] = [];
  const members: T1EpisodeMember[] = [];

  for (const range of ranges) {
    const slice = turns.filter(
      (turn) => turn.turnSeq >= range.startTurn && turn.turnSeq <= range.endTurn,
    );
    if (slice.length === 0) continue;

    const episodeId = episodeIdFor(sessionId, range.startTurn);
    const first = slice[0];
    const last = slice[slice.length - 1];

    const actorMap = new Map<string, { actorId: string; role: string; weight: number }>();
    const conceptIds: string[] = [];
    for (const turn of slice) {
      const actorRows =
        turn.actorRoles ??
        turn.specificActors.map((actorId) => ({ actorId, role: 'subject', weight: 1 }));
      for (const actor of actorRows) {
        const previous = actorMap.get(actor.actorId);
        if (!previous || previous.weight < actor.weight) {
          actorMap.set(actor.actorId, { ...actor });
        }
      }
      conceptIds.push(...turn.conceptIds);
    }

    episodes.push({
      episodeId,
      sessionId,
      startTurn: range.startTurn,
      endTurn: range.endTurn,
      status: range.status,
      startedAt: first.createdAt,
      endedAt: range.status === 'closed' ? last.createdAt : null,
      goalId: firstNonEmpty(slice.map((turn) => turn.goalId)),
      boundarySource: range.boundarySource,
      boundaryReason: range.boundaryReason,
      confidence: range.confidence,
      intent: firstNonEmpty(slice.map((turn) => turn.intent)),
      outcome: lastNonEmpty(slice.map((turn) => turn.outcome)),
      actors: [...actorMap.values()].sort(
        (a, b) => b.weight - a.weight || a.actorId.localeCompare(b.actorId),
      ),
      conceptIds: unique(conceptIds),
      sourceTraceIds: unique(slice.map((turn) => turn.traceId)),
    });

    for (const turn of slice) {
      members.push({ episodeId, traceId: turn.traceId, turnSeq: turn.turnSeq });
    }
  }

  db.replaceSessionEpisodes(sessionId, episodes, members);
  if (opts.shadowLogPath) {
    try {
      fs.mkdirSync(path.dirname(opts.shadowLogPath), { recursive: true });
      const lines = episodes
        .map((episode) =>
          JSON.stringify({
            ts: Date.now(),
            sessionId,
            episodeId: episode.episodeId,
            startTurn: episode.startTurn,
            endTurn: episode.endTurn,
            boundarySource: episode.boundarySource,
            boundaryReason: episode.boundaryReason,
            confidence: episode.confidence,
            actors: episode.actors.map((actor) => actor.actorId),
            conceptIds: episode.conceptIds,
          }),
        )
        .join('\n');
      if (lines) fs.appendFileSync(opts.shadowLogPath, `${lines}\n`, 'utf-8');
    } catch {
      /* fail-open: shadow logging never blocks the rebuild */
    }
  }
  return { episodes, members };
}

export interface T1EpisodeBackfillResult {
  scanned: number;
  rebuilt: number;
  failed: number;
}

/**
 * One bounded backfill pass over sessions with T1 turns. Repeat until
 * `scanned === 0`. A bad session increments `failed` and does not abort the
 * pass.
 */
export function backfillT1Episodes(
  db: GatewayDatabase,
  opts: { limit?: number; sinceDays?: number; now?: number } = {},
): T1EpisodeBackfillResult {
  const result: T1EpisodeBackfillResult = { scanned: 0, rebuilt: 0, failed: 0 };
  const limit = Math.max(0, Math.trunc(opts.limit ?? 500));
  if (limit === 0) return result;
  const now = opts.now ?? Date.now();
  const since =
    opts.sinceDays && opts.sinceDays > 0
      ? now - opts.sinceDays * 86400_000
      : undefined;
  const sessions = db.listEpisodeSessionIds({ limit, since });
  result.scanned = sessions.length;
  for (const sessionId of sessions) {
    try {
      const rebuilt = rebuildSessionEpisodes(db, sessionId, { now });
      if (rebuilt) result.rebuilt++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** Close open episodes whose last turn is older than `idleMs`. */
export function closeIdleEpisodes(
  db: GatewayDatabase,
  opts: { idleMs?: number; now?: number } = {},
): number {
  const now = opts.now ?? Date.now();
  const idleMs = Math.max(0, Math.trunc(opts.idleMs ?? config.recall.t1Episodes.idleCloseMs));
  if (idleMs === 0) return 0;
  const open = db
    .listEpisodes({ limit: 5000 })
    .episodes.filter((episode) => episode.status === 'open');
  let closed = 0;
  for (const episode of open) {
    const last = db.getEpisodeLastTurnAt(episode.episodeId);
    if (last == null || now - last < idleMs) continue;
    try {
      db.closeEpisode(episode.episodeId, last, 'idle_timeout');
      closed++;
    } catch {
      /* fail-open: a later pass retries */
    }
  }
  return closed;
}
