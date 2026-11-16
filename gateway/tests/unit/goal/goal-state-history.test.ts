import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import {
  ensureGoalState, setGoalStateBackend, writeGoalState,
} from '../../../src/core/goal/state-v3';

function setup() {
  const db = new Database(':memory:');
  const events = new DomainEventStore(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-history-'));
  const store = new GoalStateStore(db, { events });
  setGoalStateBackend(store);
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  return { db, events, dir, store };
}

function teardown(h: ReturnType<typeof setup>) {
  setGoalStateBackend(null);
  h.db.close();
  fs.rmSync(h.dir, { recursive: true, force: true });
}

test('every write appends one goal.state.changed event with the patch', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    writeGoalState(h.dir, 'g1', { round: 2 });
    const events = h.events.listAggregate('goal', 'g1');
    expect(events.map((e) => e.type)).toEqual([
      'goal.state.changed', 'goal.state.changed', 'goal.state.changed',
    ]);
    expect(events[1].payload).toMatchObject({ patch: { phase: 'EXECUTING' }, reset: false });
    expect(events[0].payload).toMatchObject({ reset: true });
    expect(events[2].payload).toMatchObject({ round: 2, loop: 2 });
  } finally {
    teardown(h);
  }
});

test('history is skipped when no event store is wired', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-history-'));
  const store = new GoalStateStore(db);
  setGoalStateBackend(store);
  try {
    fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
    ensureGoalState(dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(dir, 'g1', { phase: 'EXECUTING' });
    expect(store.list()).toHaveLength(1);
  } finally {
    setGoalStateBackend(null);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
