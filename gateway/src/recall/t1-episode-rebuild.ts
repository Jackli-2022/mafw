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
  return { episodes, members };
}
