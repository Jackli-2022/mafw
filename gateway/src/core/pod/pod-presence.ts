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
}

export interface PodPresenceItem {
  podId: string;
  projectId: string;
  projectName: string;
  goalId: string;
  title: string;
  phase: string | null;
  node: string | null;
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

  for (const input of inputs) {
    const projectId = input.parentProjectId ?? input.projectId;
    for (const goal of input.goals) {
      const item = toItem(input, projectId, goal);
      const terminal = goal.status === 'done' || goal.status === 'aborted' || !!goal.endedAt;
      if (!terminal) {
        running.push(item);
      } else if (goal.resultReady && goal.verdict !== 'CANCELLED') {
        results.push(item);
      }
    }
    attentionItems.push(...input.attention);
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    running,
    attention: { count: attentionItems.length, items: attentionItems },
    unreadResults: { count: results.length, latest: results[0] ?? null },
  };
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
    progress: total > 0 ? { current, total } : null,
    startedAt: goal.startedAt ?? '',
    updatedAt: goal.endedAt ?? goal.startedAt ?? '',
  };
}
