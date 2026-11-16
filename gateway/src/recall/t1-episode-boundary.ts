// Pure episode boundary rules. Declared boundaries win; inference only
// evaluates on user turns and uses the episode profile (not just the previous
// turn). Structural/time signals add confidence but never cut on their own.
import type {
  T1EpisodeBoundary,
  T1EpisodeBoundaryReason,
  T1EpisodeBoundarySource,
  T1EpisodeStatus,
} from './t1-episodes';

export interface EpisodeTurnInput {
  turnSeq: number;
  traceId: string;
  createdAt: number;
  isUserTurn: boolean;
  intent?: string;
  /** Actors excluding the generic `user:local`. */
  specificActors: string[];
  conceptIds: string[];
  entities: string[];
  /** `sem:` term ids, prefix stripped. */
  semanticAtoms: string[];
  goalId?: string;
  /** Directory / tool-failure / goal structural flag (confidence only). */
  structuralBreak?: boolean;
  /** Structured actor rows when available (roles/weights preserved). */
  actorRoles?: Array<{ actorId: string; role: string; weight: number }>;
  /** Last feature result/decision for the episode outcome. */
  outcome?: string;
}

export interface ComputeEpisodeRangesInput {
  sessionId: string;
  turns: EpisodeTurnInput[];
  boundaries: T1EpisodeBoundary[];
  maxTurns: number;
  idleCloseMs: number;
  now: number;
  sessionDeleted?: boolean;
  /** Weak-prior gap; defaults to idleCloseMs / 3 (2h for a 6h idle close). */
  timeGapWeakMs?: number;
}

export interface EpisodeRange {
  startTurn: number;
  endTurn: number;
  status: T1EpisodeStatus;
  boundarySource: T1EpisodeBoundarySource;
  boundaryReason: T1EpisodeBoundaryReason;
  confidence: number;
}

function tokensOf(text: string | undefined): Set<string> {
  const value = String(text ?? '').toLowerCase();
  const out = new Set<string>();
  for (const match of value.matchAll(/[\p{L}\p{N}_-]{2,}/gu)) {
    const token = match[0];
    if (/[\u4e00-\u9fff]/.test(token)) {
      // CJK has no spaces: use characters so two Chinese intents can differ.
      for (const char of token) {
        if (/[\u4e00-\u9fff]/.test(char)) out.add(char);
      }
    } else {
      out.add(token);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function topicOf(turn: EpisodeTurnInput): Set<string> {
  return new Set([...turn.conceptIds, ...turn.entities]);
}

function declaredReason(boundary: T1EpisodeBoundary): T1EpisodeBoundaryReason {
  return boundary.reason ?? (boundary.source === 'user' ? 'user_declared' : 'agent_declared');
}

/**
 * Walk one session's ordered turns and return episode ranges. The last range is
 * open unless the session was deleted or the tail is older than `idleCloseMs`.
 */
export function computeEpisodeRanges(input: ComputeEpisodeRangesInput): EpisodeRange[] {
  const turns = [...(input.turns ?? [])].sort((a, b) => a.turnSeq - b.turnSeq);
  if (turns.length === 0) return [];

  const maxTurns = Math.max(1, Math.trunc(input.maxTurns));
  const idleCloseMs = Math.max(0, Math.trunc(input.idleCloseMs));
  const weakGapMs = Math.max(0, Math.trunc(input.timeGapWeakMs ?? idleCloseMs / 3));

  const declaredByAfter = new Map<number, T1EpisodeBoundary>();
  for (const boundary of input.boundaries ?? []) {
    if (boundary.sessionId !== input.sessionId) continue;
    if (boundary.afterTurn < turns[0].turnSeq) continue; // no empty first episode
    if (!declaredByAfter.has(boundary.afterTurn)) {
      declaredByAfter.set(boundary.afterTurn, boundary);
    }
  }

  const out: EpisodeRange[] = [];
  let startIndex = 0;
  let start: { source: T1EpisodeBoundarySource; reason: T1EpisodeBoundaryReason; confidence: number } = {
    source: 'session_start',
    reason: 'session_start',
    confidence: 1,
  };

  let actors = new Set<string>();
  let topics = new Set<string>();
  let atoms = new Set<string>();
  let intentTokens = new Set<string>();
  let goalId: string | undefined;

  const push = (endIndex: number) => {
    out.push({
      startTurn: turns[startIndex].turnSeq,
      endTurn: turns[endIndex].turnSeq,
      status: 'closed',
      boundarySource: start.source,
      boundaryReason: start.reason,
      confidence: start.confidence,
    });
  };

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (i > 0) {
      const previous = turns[i - 1];
      const declared = declaredByAfter.get(previous.turnSeq);
      const length = i - startIndex;

      let cut:
        | { source: T1EpisodeBoundarySource; reason: T1EpisodeBoundaryReason; confidence: number }
        | null = null;

      if (declared) {
        cut = {
          source: 'declared',
          reason: declaredReason(declared),
          confidence: 1,
        };
      } else if (length >= maxTurns) {
        cut = { source: 'max_length', reason: 'max_length', confidence: 1 };
      } else if (turn.isUserTurn) {
        const turnActors = new Set(turn.specificActors);
        const turnTopics = topicOf(turn);
        const turnAtoms = new Set(turn.semanticAtoms);

        const actorShift =
          actors.size > 0 && turnActors.size > 0 && !intersects(actors, turnActors);
        const topicShift =
          topics.size > 0 && turnTopics.size > 0 && !intersects(topics, turnTopics);
        const intentShift =
          !actorShift &&
          !topicShift &&
          atoms.size > 0 &&
          turnAtoms.size > 0 &&
          !intersects(atoms, turnAtoms) &&
          jaccard(tokensOf(turn.intent), intentTokens) < 0.15 &&
          tokensOf(turn.intent).size >= 3;

        if (actorShift || topicShift || intentShift) {
          let confidence = actorShift ? 0.8 : topicShift ? 0.7 : 0.6;
          if (goalId && turn.goalId && turn.goalId !== goalId) confidence += 0.1;
          if (weakGapMs > 0 && turn.createdAt - previous.createdAt >= weakGapMs) confidence += 0.1;
          if (turn.structuralBreak) confidence += 0.1;
          cut = {
            source: 'inferred',
            reason: actorShift ? 'actor_shift' : topicShift ? 'topic_shift' : 'intent_shift',
            confidence: Math.min(0.95, confidence),
          };
        }
      }

      if (cut) {
        push(i - 1);
        startIndex = i;
        start = cut;
        actors = new Set();
        topics = new Set();
        atoms = new Set();
        intentTokens = new Set();
        goalId = undefined;
      }
    }

    for (const actor of turn.specificActors) actors.add(actor);
    for (const topic of topicOf(turn)) topics.add(topic);
    for (const atom of turn.semanticAtoms) atoms.add(atom);
    for (const token of tokensOf(turn.intent)) intentTokens.add(token);
    if (turn.goalId) goalId = turn.goalId;
  }

  push(turns.length - 1);

  const tail = out[out.length - 1];
  const last = turns[turns.length - 1];
  const idleClosed =
    !input.sessionDeleted &&
    idleCloseMs > 0 &&
    input.now - last.createdAt >= idleCloseMs;
  if (input.sessionDeleted || idleClosed) {
    tail.status = 'closed';
    tail.boundarySource = 'session_end';
    tail.boundaryReason = input.sessionDeleted ? 'session_deleted' : 'idle_timeout';
    tail.confidence = 1;
  } else {
    tail.status = 'open';
  }

  return out;
}
