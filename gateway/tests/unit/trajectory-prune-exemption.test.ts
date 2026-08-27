import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { TrajectoryStore } from '../../src/trajectory/trajectory-store';

describe('TrajectoryStore prune exemption', () => {
  let db: GatewayDatabase;
  let store: TrajectoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-prune-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    store = new TrajectoryStore(db, 'proj1');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('prune deletes old turns but exempts goal sessions', () => {
    const oldMs = Date.now() - 20 * 86400 * 1000;
    store.upsertTurn({
      projectID: 'proj1', sessionID: 's1', turnID: 1,
      turnStartMs: oldMs, turnEndMs: oldMs, durationMs: 100,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001, finish: 'stop', model: 'm', provider: 'p', agent: 'a', userText: 'hi',
    });
    store.upsertTurn({
      projectID: 'proj1', sessionID: 's2', turnID: 1,
      turnStartMs: oldMs, turnEndMs: oldMs, durationMs: 100,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001, finish: 'stop', model: 'm', provider: 'p', agent: 'a', userText: 'hi',
    });

    db.addGoalSession({ goal_id: 'g1', session_id: 's2', phase: 'plan', loop: 1 });

    const cutoffSec = Math.floor(Date.now() / 1000) - 20 * 86400;
    const rawDb = (db as any).db;
    rawDb.prepare('UPDATE trajectory_turns SET created_at = ?').run(cutoffSec);

    store.pruneOlderThan(14);

    const summary1 = store.getSessionTokenSummary('s1');
    expect(summary1.turnCount).toBe(0);
    const summary2 = store.getSessionTokenSummary('s2');
    expect(summary2.turnCount).toBe(1);
  });
});
