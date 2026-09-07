import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { TrajectoryStore } from '../../src/trajectory/trajectory-store';

describe('getModelUsageStats', () => {
  let db: GatewayDatabase;
  let tmpDir: string;
  let store: TrajectoryStore;

  const insertTurn = (opts: {
    sessionID: string; turnID: number; model?: string | null;
    provider?: string | null; tokens?: any; ageSec?: number;
  }) => {
    store.upsertTurn({
      projectID: 'p1',
      sessionID: opts.sessionID,
      turnID: opts.turnID,
      turnStartMs: Date.now(),
      turnEndMs: Date.now(),
      durationMs: 1000,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: 'tokens' in opts ? opts.tokens : { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      finish: 'stop',
      model: opts.model === undefined ? 'mimo-v2.5' : opts.model,
      provider: opts.provider === undefined ? 'xiaomi' : opts.provider,
      agent: 'build',
      userText: 'hi',
    } as any);
    if (opts.ageSec) {
      const created = Math.floor(Date.now() / 1000) - opts.ageSec;
      (db as any).db
        .prepare('UPDATE trajectory_turns SET created_at = ? WHERE session_id = ? AND turn_id = ?')
        .run(created, opts.sessionID, opts.turnID);
    }
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-stats-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    store = new TrajectoryStore(db, 'p1');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('aggregates per provider+model, sorted by total tokens desc', () => {
    insertTurn({ sessionID: 's1', turnID: 1, tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } } });
    insertTurn({ sessionID: 's1', turnID: 2, tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } });
    insertTurn({ sessionID: 's2', turnID: 1, model: 'qwen3.7-max', provider: 'alibaba-cn', tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } } });

    const rows = store.getModelUsageStats(null);
    expect(rows).toHaveLength(2);
    expect(rows[0].model).toBe('qwen3.7-max'); // 1500 > 467
    expect(rows[1].model).toBe('mimo-v2.5');
    expect(rows[1].turns).toBe(2);
    expect(rows[1].tokens).toEqual({ input: 300, output: 150, reasoning: 10, cache: { read: 5, write: 2 } });
    expect(rows[0].provider).toBe('alibaba-cn');
  });

  test('window filter excludes old turns; null means all', () => {
    insertTurn({ sessionID: 's1', turnID: 1, ageSec: 10 * 86400 });
    insertTurn({ sessionID: 's1', turnID: 2 });

    const recent = store.getModelUsageStats(Math.floor(Date.now() / 1000) - 7 * 86400);
    expect(recent).toHaveLength(1);
    expect(recent[0].turns).toBe(1);

    const all = store.getModelUsageStats(null);
    expect(all[0].turns).toBe(2);
  });

  test('null tokens and null model handled', () => {
    insertTurn({ sessionID: 's1', turnID: 1, tokens: null as any });
    insertTurn({ sessionID: 's1', turnID: 2, model: null });

    const rows = store.getModelUsageStats(null);
    expect(rows).toHaveLength(1); // model=null 行被排除
    expect(rows[0].tokens.input).toBe(0);
  });
});
