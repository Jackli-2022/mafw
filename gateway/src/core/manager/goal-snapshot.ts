import * as fs from 'fs';
import * as path from 'path';

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED']);

export interface GoalSnapshotEntry {
  goalId: string;
  title: string;
  phase: string;
  round: number;
  pendingQuestions: number;
}

export function collectActiveGoals(mafwDir: string): GoalSnapshotEntry[] {
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return [];
  const entries: GoalSnapshotEntry[] = [];
  for (const file of fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      if (TERMINAL_ACTIONS.has(s.nextAction)) continue;
      const pendingQ = s.pendingQuestion
        ? (Array.isArray(s.pendingQuestion.questions) ? s.pendingQuestion.questions.length : 1)
        : 0;
      entries.push({
        goalId: s.goalId || file.replace('.json', ''),
        title: s.title || s.goalId || file.replace('.json', ''),
        phase: s.phase || 'UNKNOWN',
        round: s.round ?? 0,
        pendingQuestions: pendingQ,
      });
    } catch { /* skip corrupt state */ }
  }
  return entries;
}

export function buildGoalSnapshot(mafwDir: string, opts?: { maxGoals?: number }): string | null {
  const maxGoals = opts?.maxGoals ?? 10;
  const goals = collectActiveGoals(mafwDir);
  if (goals.length === 0) return null;
  const lines = goals.slice(0, maxGoals).map(g =>
    `- ${g.goalId}: ${g.title} [phase=${g.phase} round=${g.round}${g.pendingQuestions > 0 ? ` pendingQ=${g.pendingQuestions}` : ''}]`,
  );
  return `<goal-snapshot>\n${lines.join('\n')}\n</goal-snapshot>`;
}
