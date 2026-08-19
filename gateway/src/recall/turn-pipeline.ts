// Pipeline 1: observation → compression → memory. Runs on a cron (hourly).
// For every active session it batches ALL completed turns of the last hour
// into one transcript and asks the session's persistent worker agent to save
// durable memories itself via mafw_add_memory (the gateway does not parse
// output or write memories — the agent decides what is worth remembering, how
// many entries, and their types).
//
// Processed turns are always deleted afterwards ("processed = done", failed
// batches are not retried — the agent already saw the material).
import { GatewayDatabase, T1Observation } from '../memory/gateway-db';
import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { MemoryWorker } from './memory-worker';
import { completeTurns, TurnEval } from './turn-completion';

export interface TurnPipelineOptions {
  t1db: GatewayDatabase;
  index: HarmonicIndexManager; // single shared instance (for prior-turn context)
  workerFor: (sessionID: string) => MemoryWorker;
  staleMs: number;
  maxObservationsPerSession?: number;
  contextEpisodes?: number; // prior-turn context lines injected into the prompt
  /** Pin a model for each worker prompt. */
  workerModel?: { providerID: string; modelID: string };
}

export interface TurnPipelineResult {
  sessions: number;
  turns: number;
  deleted: number;
  failed: number;
}

const TOOL_EXTRACTION_SYSTEM = `You are a memory curator for a coding agent. Review the conversation observations of this session and record durable memories.
Use the mafw_add_memory tool to save every entry worth remembering long-term:
- semantic: durable facts, decisions, preferences, user constraints
- episodic: what happened (task narratives, outcomes)
- procedural: reusable lessons, patterns, mistakes to avoid
Rules:
- one memory per mafw_add_memory call; memory_value concise; attach cue_anchors keywords
- every cue_anchors list MUST include the topic entity names (project, module, person, API, feature) so the memory can be retrieved across sessions
- for preferences or constraints, include a machine-readable anchor like "pref:<dimension>=<value>" (e.g., "pref:ui-language=chinese") in addition to the entity
- skip redundant or trivial content; do not repeat entries that are obviously already known
- if nothing is worth saving, do not call the tool`;

function observationsToTranscript(obs: T1Observation[]): string {
  return obs
    .map((o) => {
      const tag =
        o.source === 'user_input' ? 'USER' : o.source === 'reasoning' ? 'THINKING' : o.source === 'tool_result' ? 'TOOL' : 'ASSISTANT';
      return `[${tag}] ${o.content}`;
    })
    .join('\n');
}

/**
 * Prior-turn context for a session: the K most recent completed episodes'
 * primary abstractions (from the shared index, filtered by source_session_id).
 * Keeps the hourly narrative anchored to what came before.
 */
export function sessionContext(
  index: HarmonicIndexManager,
  sessionID: string,
  maxEpisodes: number = 10,
): string {
  const prior = index
    .getIndex()
    .entries.filter((e) => e.type === 'episodic' && e.source_session_id === sessionID)
    .slice(-maxEpisodes)
    .map((e) => `- ${e.primary_abstraction}`);
  return prior.length > 0 ? prior.join('\n') : '';
}

export class TurnPipeline {
  constructor(private opts: TurnPipelineOptions) {}

  async runOnce(): Promise<TurnPipelineResult> {
    const result: TurnPipelineResult = { sessions: 0, turns: 0, deleted: 0, failed: 0 };
    const turns = this.opts.t1db.listTurns();
    const complete = completeTurns(turns, { staleMs: this.opts.staleMs });

    // Group completed turns per session (hourly batch granularity).
    const bySession = new Map<string, TurnEval[]>();
    for (const t of complete) {
      const list = bySession.get(t.session_id);
      if (list) list.push(t);
      else bySession.set(t.session_id, [t]);
    }

    for (const [sessionID, sessionTurns] of bySession) {
      result.sessions++;
      result.turns += sessionTurns.length;

      // 1) merge all observations of the session's completed turns
      const observations: T1Observation[] = [];
      for (const t of sessionTurns) {
        observations.push(...this.opts.t1db.readTurn(t.session_id, t.turn_id));
      }
      const transcript = observationsToTranscript(
        observations.slice(0, this.opts.maxObservationsPerSession ?? 200),
      );

      // 2) ask the session's persistent worker agent to save memories itself
      if (transcript.trim()) {
        const context = sessionContext(this.opts.index, sessionID, this.opts.contextEpisodes ?? 10);
        const prompt = context
          ? `Prior episodes of this conversation:\n${context}\n\nObservations of the last hour:\n${transcript}`
          : `Observations of the last hour:\n${transcript}`;
        try {
          await this.opts.workerFor(sessionID).prompt(prompt, TOOL_EXTRACTION_SYSTEM, this.opts.workerModel);
        } catch {
          result.failed++;
        }
      }

      // 3) processed = done — delete the session's completed turns regardless
      // of whether the agent wrote anything (empty/failed batches are not
      // retried; re-running them would only re-prompt the same material).
      for (const t of sessionTurns) {
        this.opts.t1db.deleteTurn(t.session_id, t.turn_id);
        result.deleted++;
      }
    }

    return result;
  }
}
