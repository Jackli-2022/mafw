import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';
import { handleTrajectoryRequest } from '../../../gateway/src/trajectory/api';

let dir: string;
let db: GatewayDatabase;
let store: TrajectoryStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-api-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new TrajectoryStore(db, '/proj');
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('empty session returns empty arrays (fail-open)', async () => {
  const r = await handleTrajectoryRequest({ store, sessionID: 's1', opts: { limit: 50 } });
  expect(r).toEqual({ turns: [], events: [] });
});

test('rebuild=1 reconstructs tool + reasoning events from messages (info/parts)', async () => {
  const messages = [
    { id: 'u1', info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1000 }, agent: 'build', model: { modelID: 'm1' } }, parts: [{ id: 't1', type: 'text', text: 'hello rebuild' }] },
    {
      id: 'a1',
      info: { id: 'a1', sessionID: 's1', role: 'assistant', parentID: 'u1', modelID: 'm1', cost: 0.05, tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 0 } }, finish: 'stop', time: { created: 1000, completed: 2500 } },
      parts: [
        { id: 'p1', messageID: 'a1', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'completed', input: {}, output: 'out', title: 'ls', metadata: {}, time: { start: 1000, end: 2500 } } },
        { id: 'p2', messageID: 'a1', type: 'reasoning', text: 'think', time: { start: 1000, end: 1100 } },
      ],
    },
  ];
  const r = await handleTrajectoryRequest({ store, sessionID: 's1', opts: { limit: 50, rebuild: true }, messages: { data: messages } });
  expect(r.turns.length).toBeGreaterThan(0);
  const types = r.events.map(e => e.eventType);
  expect(types).toContain('tool_start');
  expect(types).toContain('tool_end');
  expect(types).toContain('reasoning_start');
  expect(types).toContain('reasoning_end');
  const toolEnd = r.events.find(e => e.eventType === 'tool_end');
  expect(toolEnd?.durationMs).toBe(1500);
});
