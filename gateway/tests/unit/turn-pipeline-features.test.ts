import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { TurnPipeline } from '../../src/recall/turn-pipeline';

describe('TurnPipeline writes the T1 sparse event code', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-feature-pipeline-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('builds a feature before archiving the turn', async () => {
    const turn = db.beginTurn('s1');
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content: '修一下 reflection，为什么 unparseable',
      failure: 0,
    });
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'tool_result',
      content: 'read reflection.ts',
      failure: 0,
    });
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'assistant_reply',
      content: '决定 adapter 前置 system。',
      failure: 0,
    });

    const index: any = { getIndex: () => ({ entries: [] }) };
    const worker: any = { prompt: async () => '[EXTRACTED: 0]' };
    const pipeline = new TurnPipeline({
      t1db: db,
      index,
      workerFor: () => worker,
      staleMs: 60_000,
    });

    await pipeline.runOnce();

    const feature = db.getTurnFeature(turn.trace_id);
    expect(feature).not.toBeNull();
    expect(feature!.intent).toContain('修一下 reflection');
    expect(feature!.action).toContain('reflection.ts');
    expect(feature!.decision).toContain('adapter 前置 system');
  });
});
