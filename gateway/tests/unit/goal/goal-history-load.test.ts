import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { GoalSnapshotStore } from '../../../src/core/goal/goal-history';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import {
  ensureGoalState, listGoalStateSummaries, setGoalStateBackend, statePathFor, writeGoalState,
} from '../../../src/core/goal/state-v3';

function setup() {
  const db = new Database(':memory:');
  const events = new DomainEventStore(db);
  const snapshots = new GoalSnapshotStore(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-history-load-'));
  const store = new GoalStateStore(db, { events, snapshots });
  setGoalStateBackend(store);
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  return { db, events, snapshots, dir, store };
}

function teardown(h: ReturnType<typeof setup>) {
  setGoalStateBackend(null);
  h.db.close();
  fs.rmSync(h.dir, { recursive: true, force: true });
}

test('load replays when the state row is missing but history exists', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    h.db.prepare('DELETE FROM goal_state WHERE goal_id = ?').run('g1');
    fs.rmSync(statePathFor(h.dir, 'g1'), { force: true });
    const state = h.store.load(h.dir, 'g1');
    expect(state).toMatchObject({ goalId: 'g1', phase: 'EXECUTING' });
    expect(h.db.prepare('SELECT COUNT(*) n FROM goal_state WHERE goal_id = ?').get('g1'))
      .toMatchObject({ n: 1 });
  } finally {
    teardown(h);
  }
});

test('list recovers a goal whose row and mirror are gone', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    h.db.prepare('DELETE FROM goal_state WHERE goal_id = ?').run('g1');
    fs.rmSync(statePathFor(h.dir, 'g1'), { force: true });
    const summaries = listGoalStateSummaries([{ projectDir: '/p', mafwDir: h.dir }]);
    expect(summaries.map((entry) => entry.goalId)).toContain('g1');
    expect(h.store.load(h.dir, 'g1')?.phase).toBe('EXECUTING');
  } finally {
    teardown(h);
  }
});

test('replay-read flag returns history state and counts divergence', () => {  const h = setup();
  const prev = process.env.MAFW_GOAL_REPLAY_READ;
  process.env.MAFW_GOAL_REPLAY_READ = '1';
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    h.db.prepare("UPDATE goal_state SET state_json = json_set(state_json, '$.phase', 'TAMPERED') WHERE goal_id = ?").run('g1');
    expect(h.store.load(h.dir, 'g1')?.phase).toBe('EXECUTING');
    expect(h.store.replayStats().divergences).toBe(1);
  } finally {
    if (prev === undefined) delete process.env.MAFW_GOAL_REPLAY_READ;
    else process.env.MAFW_GOAL_REPLAY_READ = prev;
    teardown(h);
  }
});
