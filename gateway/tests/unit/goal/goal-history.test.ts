import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { GoalSnapshotStore, replayGoalState } from '../../../src/core/goal/goal-history';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import {
  ensureGoalState, setGoalStateBackend, writeGoalState,
} from '../../../src/core/goal/state-v3';

function setup(opts: { snapshotEvery?: number } = {}) {
  const db = new Database(':memory:');
  const events = new DomainEventStore(db);
  const snapshots = new GoalSnapshotStore(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-history-'));
  const store = new GoalStateStore(db, {
    events,
    snapshots,
    snapshotEvery: opts.snapshotEvery,
  });
  setGoalStateBackend(store);
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  return { db, events, snapshots, dir, store };
}

function teardown(h: ReturnType<typeof setup>) {
  setGoalStateBackend(null);
  h.db.close();
  fs.rmSync(h.dir, { recursive: true, force: true });
}

test('replays from the latest snapshot plus tail', () => {
  const h = setup({ snapshotEvery: 2 });
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'PLANNING', round: 1 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    writeGoalState(h.dir, 'g1', { currentWave: 2 });
    const replayed = replayGoalState({
      goalId: 'g1', events: h.events, snapshots: h.snapshots,
    });
    expect(replayed!.state).toMatchObject({ phase: 'EXECUTING', currentWave: 2 });
    expect(replayed!.state).toEqual(h.store.load(h.dir, 'g1'));
    expect(replayed!.stats.snapshots).toBeGreaterThan(0);
  } finally {
    teardown(h);
  }
});

test('reset drops the previous revision fields', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3, revision: 1 });
    writeGoalState(h.dir, 'g1', { reviewVerdict: 'FAIL', round: 3 });
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3, revision: 2 });
    const replayed = replayGoalState({ goalId: 'g1', events: h.events, snapshots: h.snapshots });
    expect(replayed!.state).toMatchObject({ revision: 2, round: 1, reviewVerdict: null });
  } finally {
    teardown(h);
  }
});

test('replays an intermediate version for diagnostics', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'PLANNING' });
    const v = h.events.lastVersion('goal', 'g1');
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    const past = replayGoalState({ goalId: 'g1', events: h.events, snapshots: h.snapshots, atVersion: v });
    expect(past!.state.phase).toBe('PLANNING');
  } finally {
    teardown(h);
  }
});
