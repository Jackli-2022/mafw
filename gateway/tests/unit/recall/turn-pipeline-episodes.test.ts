import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { TurnPipeline } from '../../../src/recall/turn-pipeline';
import { rebuildSessionEpisodes } from '../../../src/recall/t1-episode-rebuild';

describe('TurnPipeline episode rebuild wiring', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-pipeline-episodes-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(session = 's1') {
    const turn = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content: '修一下 reflection',
      failure: 0,
    });
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'tool_result',
      content: 'read reflection.ts',
      failure: 0,
    });
    return turn;
  }

  function pipeline(rebuildEpisodes?: (sessionID: string) => void) {
    return new TurnPipeline({
      t1db: db,
      index: { getIndex: () => ({ entries: [] }) } as any,
      workerFor: () => ({ prompt: async () => '[EXTRACTED: 0]' }) as any,
      staleMs: 60_000,
      rebuildEpisodes,
    });
  }

  test('rebuilds episodes after per-turn encode', async () => {
    seed();
    const calls: string[] = [];
    await pipeline((sessionID) => {
      calls.push(sessionID);
      rebuildSessionEpisodes(db, sessionID, { now: Date.now() });
    }).runSession('s1');

    expect(calls).toEqual(['s1']);
    const episodes = db.listEpisodes({ sessionId: 's1', limit: 10 }).episodes;
    expect(episodes).toHaveLength(1);
    expect(episodes[0].sourceTraceIds.length).toBeGreaterThan(0);
  });

  test('a failing rebuild does not fail the run or block archiving', async () => {
    seed();
    const result = await pipeline(() => {
      throw new Error('rebuild down');
    }).runSession('s1');
    expect(result.archived).toBe(1);
    expect(result.failed).toBe(0);
  });
});
