import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { TrajectoryCollector } from '../../../gateway/src/trajectory/collector';

let dir: string;
let db: GatewayDatabase;
let store: TrajectoryStore;
let col: TrajectoryCollector;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-col-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new TrajectoryStore(db, '/proj');
  col = new TrajectoryCollector(store, db, '/proj');
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('user message starts a turn; tool + step-finish parts accumulate; idle aggregates', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, summary: { body: 'hello' }, agent: 'build', model: { modelID: 'm1' } } });
  col.handleEvent('message.part.updated', {
    sessionID: 's1',
    part: { sessionID: 's1', messageID: 'a1', id: 'p1', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'running', input: {}, time: { start: 1000 }, title: 'ls' } },
  });
  col.handleEvent('message.part.updated', {
    sessionID: 's1',
    part: {
      sessionID: 's1', messageID: 'a1', id: 'p1', type: 'tool', callID: 'c1', tool: 'bash',
      state: { status: 'completed', input: {}, output: 'file1', title: 'ls', metadata: {}, time: { start: 1000, end: 2500 } },
    },
  });
  col.handleEvent('message.part.updated', {
    sessionID: 's1',
    part: { sessionID: 's1', messageID: 'a1', id: 'p2', type: 'step-finish', reason: 'stop', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } } },
  });
  const turn = col.onIdle('s1');
  expect(turn).not.toBeNull();
  expect(turn!.toolCount).toBe(1);
  expect(turn!.cost).toBe(0.05);
  expect(turn!.durationMs).not.toBeNull();

  const r = store.getSessionTrajectory('s1', { limit: 50 });
  const types = r.events.map(e => e.eventType);
  expect(types).toContain('turn_start');
  expect(types).toContain('tool_start');
  expect(types).toContain('tool_end');
  expect(types).toContain('step_finish');
  expect(r.events.find(e => e.eventType === 'tool_end')!.durationMs).toBe(1500);
  expect(r.turns[0].userText).toBe('hello');
});

test('step-finish dedup: message.updated assistant fallback does not double count', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, summary: { body: 'hi' }, agent: 'build', model: { modelID: 'm1' } } });
  col.handleEvent('message.part.updated', {
    sessionID: 's1',
    part: { sessionID: 's1', messageID: 'a1', id: 'p2', type: 'step-finish', reason: 'stop', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } } },
  });
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'a1', role: 'assistant', parentID: 'u1', modelID: 'm1', providerID: 'p1', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } }, finish: 'stop', time: { created: 1000, completed: 2500 } } });
  const turn = col.onIdle('s1');
  expect(turn!.cost).toBe(0.05);
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.events.filter(e => e.eventType === 'step_finish')).toHaveLength(1);
});

test('reasoning start/end by part id', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, summary: { body: 'hi' }, agent: 'build', model: { modelID: 'm1' } } });
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', id: 'r1', type: 'reasoning', text: 'think...', time: { start: 1000 } } });
  col.handleEvent('message.part.updated', { sessionID: 's1', part: { sessionID: 's1', messageID: 'a1', id: 'r1', type: 'reasoning', text: 'think... done', time: { start: 1000, end: 3000 } } });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  const rs = r.events.filter(e => e.eventType === 'reasoning_start');
  const re = r.events.filter(e => e.eventType === 'reasoning_end');
  expect(rs).toHaveLength(1);
  expect(re).toHaveLength(1);
  expect(re[0].durationMs).toBe(2000);
});

test('model_switch on assistant message when model changes', () => {
  col.handleEvent('message.updated', { info: { sessionID: 's1', id: 'u1', role: 'user', time: { created: 1000 }, summary: { body: 'hi' }, agent: 'build', model: { modelID: 'm1' } } });
  // first assistant with m1
  col.handleEvent('message.updated', {
    info: { sessionID: 's1', id: 'a1', role: 'assistant', parentID: 'u1', modelID: 'm1', providerID: 'p1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, finish: 'tool-calls', time: { created: 1000, completed: 2000 } },
  });
  // second step with different model m2
  col.handleEvent('message.updated', {
    info: { sessionID: 's1', id: 'a2', role: 'assistant', parentID: 'u1', modelID: 'm2', providerID: 'p1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, finish: 'tool-calls', time: { created: 2000, completed: 3000 } },
  });
  const r = store.getSessionTrajectory('s1', { limit: 50 });
  expect(r.events.some(e => e.eventType === 'model_switch' && e.model === 'm2')).toBe(true);
});

test('session.idle without preceding turn returns null', () => {
  const turn = col.onIdle('no-turn');
  expect(turn).toBeNull();
});
