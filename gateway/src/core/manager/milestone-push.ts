import { log } from '../utils/logger';

// Milestones worth notifying the manager about. Phase transitions are emitted
// by syncToFile (index.ts buildNodeOptions) on the shared event bus; terminal
// verdicts arrive via onArchived (archiveGoal is the single convergence point
// of all verdict paths). Execution rounds are deliberately NOT milestones.
const MILESTONE_PHASES = new Set(['PLANNING_COMPLETE', 'REVIEWING_COMPLETE', 'ASKING_USER']);

export interface GoalStateInfo {
  stateVersion?: number;
  reviewVerdict?: string | null;
  title?: string;
}

export interface MilestonePushDeps {
  getManagerSession: (projectDir: string) => { sessionId: string } | null;
  wasNotified: (key: string) => boolean;
  markNotified: (key: string) => void;
  readGoalState: (goalId: string, projectDir: string) => GoalStateInfo | null;
  promptNoReply: (sessionId: string, text: string) => Promise<void>;
}

// Langgraph replays node side effects on crash recovery, so the same
// transition can be emitted twice — the dedupe key must include stateVersion
// and be persisted (gateway DB), never an in-process Set.
export function milestoneDedupeKey(goalId: string, phase: string, stateVersion?: number): string {
  return `${goalId}:${phase}:${stateVersion ?? 0}`;
}

export class MilestonePushNotifier {
  private queues = new Map<string, string[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private deps: MilestonePushDeps,
    private flushDelayMs = 5000,
  ) {}

  onPhaseTransition(data: { goalId: string; phase: string; loop?: number; projectDir?: string }): void {
    if (!data.projectDir || !MILESTONE_PHASES.has(data.phase)) return;
    const state = this.deps.readGoalState(data.goalId, data.projectDir);
    const key = milestoneDedupeKey(data.goalId, data.phase, state?.stateVersion ?? data.loop);
    if (this.deps.wasNotified(key)) return;
    this.deps.markNotified(key);
    this.enqueue(data.projectDir, formatMilestoneLine(data.goalId, state?.title || data.goalId, data.phase, state?.reviewVerdict));
  }

  onArchived(goalId: string, projectDir: string, verdict: string): void {
    const state = this.deps.readGoalState(goalId, projectDir);
    const key = milestoneDedupeKey(goalId, `ARCHIVED:${verdict}`, state?.stateVersion);
    if (this.deps.wasNotified(key)) return;
    this.deps.markNotified(key);
    this.enqueue(projectDir, formatMilestoneLine(goalId, state?.title || goalId, `ARCHIVED(${verdict})`));
  }

  // Per-project coalescing: bursts of transitions collapse into one message.
  private enqueue(projectDir: string, line: string): void {
    const q = this.queues.get(projectDir) || [];
    q.push(line);
    this.queues.set(projectDir, q);
    if (this.timers.has(projectDir)) return;
    this.timers.set(projectDir, setTimeout(() => { void this.flush(projectDir); }, this.flushDelayMs));
  }

  private async flush(projectDir: string): Promise<void> {
    this.timers.delete(projectDir);
    const lines = this.queues.get(projectDir) || [];
    this.queues.delete(projectDir);
    if (lines.length === 0) return;
    const session = this.deps.getManagerSession(projectDir);
    if (!session?.sessionId) return;
    const text = `[MAFW GOAL 里程碑]\n${lines.join('\n')}\n(系统通知)`;
    try {
      await this.deps.promptNoReply(session.sessionId, text);
    } catch (err: any) {
      log.warn(`[MilestonePush] push failed (fail-open): ${err.message}`);
    }
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queues.clear();
  }
}

function formatMilestoneLine(goalId: string, title: string, phase: string, verdict?: string | null): string {
  const v = verdict ? ` verdict=${verdict}` : '';
  return `- ${goalId} (${title}): ${phase}${v}`;
}
