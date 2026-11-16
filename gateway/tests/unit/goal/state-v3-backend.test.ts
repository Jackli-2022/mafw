import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import {
  archiveGoalStateForRevision,
  listGoalStateSummaries,
  loadGoalState,
  revisionStatePathFor,
  setGoalStateBackend,
  statePathFor,
  writeGoalState,
  type GoalStateV3,
} from '../../../src/core/goal/state-v3';

test('routes reads and writes through the registered backend', () => {
  const saved: GoalStateV3[] = [];
  const state = { goalId: 'g1', revision: 1, phase: 'PLANNING', stateVersion: 0 } as GoalStateV3;
  setGoalStateBackend({
    load: () => state,
    save: (_dir, _id, next) => { saved.push(next); },
    archiveRevision: () => {},
    list: () => [state],
  });
  try {
    expect(loadGoalState('/x', 'g1')?.goalId).toBe('g1');
    writeGoalState('/x', 'g1', { phase: 'EXECUTING' });
    expect(saved[0].phase).toBe('EXECUTING');
    expect(saved[0].stateVersion).toBe(0);
  } finally {
    setGoalStateBackend(null);
  }
});

test('without a backend the file store is the truth', () => {
  expect(loadGoalState('/definitely/missing', 'g1')).toBeNull();
});

test('db-mode revision archive still returns the mirror path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-archive-path-'));
  const store = new GoalStateStore(new Database(':memory:'));
  setGoalStateBackend(store);
  try {
    const state = {
      version: '3', goalId: 'g1', revision: 1, projectDir: '/p', mafwDir: dir,
      phase: 'PLANNING', round: 1, loop: 1, maxRounds: 3, reviewVerdict: null,
      reviewReportPath: null, reviewFeedback: '', wavePlanPath: null, receiptPath: null,
      lastError: null, nodeSession: null, pendingQuestion: null, userResponse: null,
      sameSigCount: 0, stateVersion: 0, nextNode: 'plan', nextAction: 'RUNNING_plan',
      artifacts: {}, currentWave: 0, totalWaves: null, sessions: {},
      updatedAt: '2026-11-16T00:00:00.000Z',
    } as GoalStateV3;
    store.save(dir, 'g1', state);
    const archived = archiveGoalStateForRevision(dir, 'g1', 1);
    expect(archived).toBe(revisionStatePathFor(dir, 'g1', 1));
    expect(fs.existsSync(archived!)).toBe(true);
  } finally {
    setGoalStateBackend(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}); 

test('db mode still discovers legacy json goals on first boot and scopes to registered workspaces', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-discovery-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(statePathFor(dir, 'legacy'), JSON.stringify({
    version: '3', goalId: 'legacy', revision: 1, projectDir: '/p', mafwDir: dir,
    phase: 'PLANNING', round: 1, loop: 1, maxRounds: 3, nextNode: 'plan',
    nextAction: 'RUNNING_plan', updatedAt: '2026-11-16T00:00:00.000Z',
  }));
  const store = new GoalStateStore(new Database(':memory:'));
  setGoalStateBackend(store);
  try {
    const summaries = listGoalStateSummaries([{ projectDir: '/p', mafwDir: dir }]);
    expect(summaries.map((entry) => entry.goalId)).toContain('legacy');
    // Imported into SQLite: the next discovery no longer needs the file.
    fs.rmSync(statePathFor(dir, 'legacy'));
    expect(loadGoalState(dir, 'legacy')?.goalId).toBe('legacy');

    store.save('/other/.mafw', 'foreign', {
      version: '3', goalId: 'foreign', revision: 1, projectDir: '/other', mafwDir: '/other/.mafw',
      phase: 'PLANNING', round: 1, loop: 1, maxRounds: 3, nextNode: 'plan',
      nextAction: 'RUNNING_plan', updatedAt: '2026-11-16T00:00:00.000Z',
    });
    const scoped = listGoalStateSummaries([{ projectDir: '/p', mafwDir: dir }]);
    expect(scoped.map((entry) => entry.goalId)).not.toContain('foreign');
  } finally {
    setGoalStateBackend(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
