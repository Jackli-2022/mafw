// Pipeline 1: observation → compression → memory. Runs on a cron (hourly).
// For every active session it batches ALL completed turns of the last hour
// into one transcript and asks the session's persistent worker agent to save
// durable memories itself via mafw_add_memory (the gateway does not parse
// output or write memories — the agent decides what is worth remembering, how
// many entries, and their types).
//
// Processed turns are archived (moved to t1_archive) rather than deleted.
// This preserves the raw observation data for future re-extraction with
// upgraded pipelines — a "you'll want this later but can't get it back"
// safeguard at near-zero storage cost for personal-scale usage.
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
  archived: number;
  failed: number;
  noops: number;
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
- if nothing is worth saving, do not call the tool

After processing, ALWAYS end your response with exactly one of these lines:
- [EXTRACTED: N] — where N is the number of mafw_add_memory calls you made
- [NOOP: reason] — if you decided nothing was worth saving, give a one-sentence reason (e.g., "routine status update, no durable facts")
This line MUST be the very last line of your response.`;

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
    const result: TurnPipelineResult = { sessions: 0, turns: 0, archived: 0, failed: 0, noops: 0 };
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
          const reply = await this.opts.workerFor(sessionID).prompt(prompt, TOOL_EXTRACTION_SYSTEM, this.opts.workerModel);
          // Parse noop indicator from the worker's response
          const noopMatch = reply.match(/\[NOOP:\s*(.+?)\]\s*$/m);
          if (noopMatch) {
            for (const t of sessionTurns) {
              this.opts.t1db.logNoop(t.session_id, t.turn_id, noopMatch[1].trim());
              result.noops++;
            }
          }
        } catch {
          result.failed++;
        }
      }

      // 3) processed = archived — move the session's completed turns to
      // t1_archive regardless of whether the agent wrote anything. The raw
      // data is preserved for future re-extraction with upgraded pipelines.
      for (const t of sessionTurns) {
        this.opts.t1db.archiveTurn(t.session_id, t.turn_id);
        result.archived++;
      }
    }

    return result;
  }
}
