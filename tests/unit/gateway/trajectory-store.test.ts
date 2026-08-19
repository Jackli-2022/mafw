import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { TrajectoryEvent } from '../../../gateway/src/trajectory/types';

let dir: string;
let db: GatewayDatabase;
let store: TrajectoryStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-test-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new TrajectoryStore(db, '/proj');
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function evt(partial: Partial<TrajectoryEvent>): Omit<TrajectoryEvent, 'id'> {
  return { projectID: '/proj', sessionID: 's1', turnID: 1, seq: 1, eventType: 'tool_start', timeMs: Date.now(), ...partial } as any;
}

test('recordEvent writes events and orders by (turn_id, seq)', () => {
  store.recordEvent(evt({ turnID: 1, seq: 1, eventType: 'tool_start', toolName: 'bash' }));
  store.recordEvent(evt({ turnID: 1, seq: 2, eventType: 'tool_end' as any, toolName: 'bash', durationMs: 1500 }));
  store.upsertTurn({
    projectID: '/proj', sessionID: 's1', turnID: 1,
    turnStartMs: 100, turnEndMs: 200, durationMs: 100,
    toolCount: 1, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
    tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.1,
    finish: 'stop', model: 'm1', agent: 'build', userText: 'hi',
  });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.events).toHaveLength(2);
  expect(r.events[0].eventType).toBe('tool_start');
  expect(r.events[1].durationMs).toBe(1500);
});

test('upsertTurn replaces by (session_id, turn_id)', () => {
  store.upsertTurn({
    projectID: '/proj', sessionID: 's1', turnID: 1,
    turnStartMs: 100, turnEndMs: 200, durationMs: 100,
    toolCount: 1, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
    tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.1,
    finish: 'stop', model: 'm1', agent: 'build', userText: 'hi',
  });
  store.upsertTurn({
    projectID: '/proj', sessionID: 's1', turnID: 1,
    turnStartMs: 100, turnEndMs: 250, durationMs: 150,
    toolCount: 2, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
    tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.2,
    finish: 'stop', model: 'm1', agent: 'build', userText: 'hi',
  });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.turns).toHaveLength(1);
  expect(r.turns[0].cost).toBe(0.2);
  expect(r.turns[0].durationMs).toBe(150);
});

test('getSessionTrajectory paginates by beforeTurn and filters events', () => {
  for (const t of [1, 2, 3]) {
    store.upsertTurn({
      projectID: '/proj', sessionID: 's1', turnID: t,
      turnStartMs: t * 100, turnEndMs: t * 200, durationMs: 100,
      toolCount: 1, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0,
      finish: 'stop', model: 'm', agent: 'build', userText: 't' + t,
    });
    store.recordEvent(evt({ turnID: t, seq: 1, eventType: 'tool_start', toolName: 'bash' }));
  }
  const page = store.getSessionTrajectory('s1', { limit: 2, beforeTurn: 3 });
  expect(page.turns.map(x => x.turnID)).toEqual([2, 1]);
  expect(page.events.map(e => e.turnID)).toEqual([1, 2]);
});

test('deleteSession removes all rows for a session', () => {
  store.upsertTurn({
    projectID: '/proj', sessionID: 's1', turnID: 1,
    turnStartMs: 1, turnEndMs: 2, durationMs: 1,
    toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0,
    finish: 'stop', model: 'm', agent: 'build', userText: 'x',
  });
  store.recordEvent(evt({ turnID: 1, seq: 1 }));
  store.deleteSession('s1');
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.turns).toHaveLength(0);
  expect(r.events).toHaveLength(0);
});

test('pruneOlderThan deletes rows older than N days', () => {
  (db as any).db.prepare(
    `INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms, tool_count, tool_error_count, reasoning_count, agent_switch_count, tokens, cost, finish, model, agent, user_text, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('/proj', 'old', 1, 1, 2, 1, 0, 0, 0, 0, JSON.stringify({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }), 0, 'stop', 'm', 'build', 'x', Math.floor(Date.now() / 1000) - 20 * 86400);
  store.pruneOlderThan(14);
  const r = store.getSessionTrajectory('old', { limit: 50 });
  expect(r.turns).toHaveLength(0);
});
