import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { GoalSnapshotStore, replayGoalState } from '../../../src/core/goal/goal-history';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import {
  ensureGoalState, setGoalStateBackend, writeGoalState, type GoalStateV3,
} from '../../../src/core/goal/state-v3';

function setup() {
  const db = new Database(':memory:');
  const events = new DomainEventStore(db);
  const snapshots = new GoalSnapshotStore(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-parity-'));
  const store = new GoalStateStore(db, { events, snapshots, snapshotEvery: 2 });
  setGoalStateBackend(store);
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  return { db, events, snapshots, dir, store };
}

function teardown(h: ReturnType<typeof setup>) {
  setGoalStateBackend(null);
  h.db.close();
  fs.rmSync(h.dir, { recursive: true, force: true });
}

test('every prefix replays to the state that was live at that version', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    const expected: Array<{ version: number; state: GoalStateV3 }> = [
      { version: h.events.lastVersion('goal', 'g1'), state: h.store.load(h.dir, 'g1')! },
    ];
    const patches = [
      { phase: 'EXECUTING' }, { currentWave: 1 }, { round: 2 },
      { reviewVerdict: 'FAIL' as const }, { nextAction: 'RUNNING_execute' },
    ];
    for (const patch of patches) {
      const state = writeGoalState(h.dir, 'g1', patch);
      expected.push({ version: h.events.lastVersion('goal', 'g1'), state });
    }
    for (const row of expected) {
      const replayed = replayGoalState({
        goalId: 'g1', events: h.events, snapshots: h.snapshots, atVersion: row.version,
      });
      expect(replayed!.state).toEqual(row.state);
    }
  } finally {
    teardown(h);
  }
});

test('prefix parity across a revision reset', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3, revision: 1 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING', currentWave: 2 });
    const v1 = h.events.lastVersion('goal', 'g1');
    const s1 = h.store.load(h.dir, 'g1')!;

    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3, revision: 2 });
    const s2 = h.store.load(h.dir, 'g1')!;

    expect(replayGoalState({
      goalId: 'g1', events: h.events, snapshots: h.snapshots, atVersion: v1,
    })!.state).toEqual(s1);
    expect(replayGoalState({
      goalId: 'g1', events: h.events, snapshots: h.snapshots,
    })!.state).toEqual(s2);
    expect(s2.revision).toBe(2);
    expect(s2.currentWave).toBe(0);
  } finally {
    teardown(h);
  }
});

test('replay performs no writes and never touches the state row', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    const before = h.db.prepare('SELECT updated_at, state_json FROM goal_state WHERE goal_id = ?').get('g1');
    const eventsBefore = h.events.lastVersion('goal', 'g1');
    replayGoalState({ goalId: 'g1', events: h.events, snapshots: h.snapshots });
    expect(h.db.prepare('SELECT updated_at, state_json FROM goal_state WHERE goal_id = ?').get('g1')).toEqual(before);
    expect(h.events.lastVersion('goal', 'g1')).toBe(eventsBefore);
  } finally {
    teardown(h);
  }
});
