// T1 episode model (derived, rebuildable). An episode is an index over turns:
// boundaries, participants, concepts, derived intent/outcome and trace ids.
// It is not a narrative and never replaces raw T1.
import { createHash } from 'crypto';

export type T1EpisodeStatus = 'open' | 'closed';

export type T1EpisodeBoundarySource =
  | 'session_start'
  | 'declared'
  | 'inferred'
  | 'session_end'
  | 'max_length';

export type T1EpisodeBoundaryReason =
  | 'session_start'
  | 'user_declared'
  | 'agent_declared'
  | 'actor_shift'
  | 'topic_shift'
  | 'intent_shift'
  | 'idle_timeout'
  | 'session_deleted'
  | 'max_length';

export interface T1EpisodeBoundary {
  sessionId: string;
  /** Canonical edge: turn N belongs to the old episode, N+1 to the new one. */
  afterTurn: number;
  source: 'agent' | 'user' | 'system';
  reason?: T1EpisodeBoundaryReason;
  intent?: string;
  createdAt: number;
}

export interface T1EpisodeRecord {
  episodeId: string;
  sessionId: string;
  startTurn: number;
  endTurn: number;
  status: T1EpisodeStatus;
  startedAt: number | null;
  endedAt: number | null;
  goalId?: string;
  boundarySource: T1EpisodeBoundarySource;
  boundaryReason: T1EpisodeBoundaryReason;
  confidence: number;
  intent?: string;
  outcome?: string;
  actors: Array<{ actorId: string; role: string; weight: number }>;
  conceptIds: string[];
  sourceTraceIds: string[];
}

export interface T1EpisodeMember {
  episodeId: string;
  traceId: string;
  turnSeq: number;
}

/**
 * Stable ID for an episode's start turn. `endTurn` is deliberately excluded so
 * an open episode keeps its ID while it grows. If a re-segmentation moves the
 * start, the old episode is retired and a new ID is minted.
 */
export function episodeIdFor(sessionId: string, startTurn: number): string {
  const digest = createHash('sha1')
    .update(`${sessionId}:${startTurn}`)
    .digest('hex')
    .slice(0, 20);
  return `t1ep_${digest}`;
}
