// gateway/src/core/pod/pod-presence.ts
// Cross-project presence for the desktop tray/taskbar. Pure projection: the
// caller supplies already-read per-pod views so this stays unit-testable.
import type { PodAttentionItem } from './pod-stage';

export interface PodPresenceGoal {
  goalId: string;
  title: string;
  phase: string | null;
  status: 'queued' | 'active' | 'done' | 'aborted';
  verdict: string | null;
  resultReady: boolean;
  endedAt: string | null;
  startedAt: string | null;
  revision?: number;
  currentAssignment?: { role?: string | null } | null;
}

export interface PodPresenceInput {
  podId: string;
  projectId: string;
  /** Worktree pods fold into the parent project so one logical project is one entry. */
  parentProjectId?: string;
  projectName: string;
  goals: PodPresenceGoal[];
  tasks: Array<{ goalId: string | null; status: string }>;
  attention: PodAttentionItem[];
  /** Unread p1 events for this pod (`goalId` + `revision`), from `pod_events`. */
  unread?: Array<{ goalId: string | null; revision: number | null }>;
}

export interface PodPresenceItem {
  podId: string;
  projectId: string;
  projectName: string;
  goalId: string;
  title: string;
  phase: string | null;
  node: string | null;
  revision: number;
  progress: { current: number; total: number } | null;
  startedAt: string;
  updatedAt: string;
}

export interface PodPresence {
  running: PodPresenceItem[];
  attention: { count: number; items: PodAttentionItem[] };
  unreadResults: { count: number; latest: PodPresenceItem | null };
}

export function buildPodPresence(inputs: PodPresenceInput[]): PodPresence {
  const running: PodPresenceItem[] = [];
  const attentionItems: PodAttentionItem[] = [];
  const results: PodPresenceItem[] = [];
  // Worktree pods fold into the parent project: the same goal may be visible from
  // both the parent and the worktree pod, so dedupe by (folded project, goal, revision)
  // instead of emitting two identical rows for one logical project.
  const seenGoals = new Set<string>();
  const seenAttention = new Set<string>();

  for (const input of inputs) {
    const projectId = input.parentProjectId ?? input.projectId;
    // Unread results come from `pod_events` (p1), not from `resultReady`:
    // resultReady never returns to false, so it would latch the tray forever.
    const unreadKeys = new Set((input.unread ?? []).map((item) => `${item.goalId}:r${item.revision ?? 1}`));
    for (const goal of input.goals) {
      const item = toItem(input, projectId, goal);
      const key = `${goal.goalId}:r${goal.revision ?? 1}`;
      const dedupe = `${projectId}\u0000${key}`;
      if (seenGoals.has(dedupe)) continue;
      if (unreadKeys.has(key)) {
        seenGoals.add(dedupe);
        results.push(item);
      } else if (!isTerminal(goal)) {
        seenGoals.add(dedupe);
        running.push(item);
      }
    }
    for (const item of input.attention) {
      if (seenAttention.has(item.id)) continue;
      seenAttention.add(item.id);
      // Attention is consumed across projects (mobile work tab) — carry the
      // owning Pod + the parent-folded project so a tap can switch projects and
      // open the Goal without a second lookup. Producers may be more precise,
      // so their own values win when present.
      attentionItems.push({
        ...item,
        podId: item.podId ?? input.podId,
        projectId: item.projectId ?? projectId,
      });
    }
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    running,
    attention: { count: attentionItems.length, items: attentionItems },
    unreadResults: { count: results.length, latest: results[0] ?? null },
  };
}

function isTerminal(goal: PodPresenceGoal): boolean {
  return goal.status === 'done' || goal.status === 'aborted' || !!goal.endedAt;
}

function nodeOf(goal: PodPresenceGoal): string | null {
  const role = goal.currentAssignment?.role;
  if (role === 'builder') return 'execute';
  if (role === 'reviewer') return 'review';
  switch (goal.phase) {
    case 'PLANNING':
      return 'plan';
    case 'EXECUTING':
      return 'execute';
    case 'REVIEWING':
      return 'review';
    default:
      return null;
  }
}

function toItem(input: PodPresenceInput, projectId: string, goal: PodPresenceGoal): PodPresenceItem {
  const mine = input.tasks.filter((task) => task.goalId === goal.goalId);
  const total = mine.length;
  const current = mine.filter((task) => task.status === 'done').length;
  return {
    podId: input.podId,
    projectId,
    projectName: input.projectName,
    goalId: goal.goalId,
    title: goal.title,
    phase: goal.phase,
    node: nodeOf(goal),
    revision: goal.revision ?? 1,
    progress: total > 0 ? { current, total } : null,
    startedAt: goal.startedAt ?? '',
    updatedAt: goal.endedAt ?? goal.startedAt ?? '',
  };
}
