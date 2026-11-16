import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { TurnPipeline } from '../../../src/recall/turn-pipeline';
import type { TurnSignalInput } from '../../../src/recall/t1-signals';
import { config } from '../../../src/config';

describe('TurnPipeline signals wiring', () => {
  let dir: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-pipeline-signals-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed() {
    const turn = db.beginTurn('s1');
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content: '修一下 reflection 的边界 recall',
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
    return turn;
  }

  function pipeline(signalsFor: any) {
    return new TurnPipeline({
      t1db: db,
      index: { getIndex: () => ({ entries: [] }) } as any,
      workerFor: () => ({ prompt: async () => '[EXTRACTED: 0]' }) as any,
      staleMs: 60_000,
      signalsFor,
    });
  }

  test('writes computed signals onto the turn feature', async () => {
    const turn = seed();
    let seen: TurnSignalInput[] = [];
    await pipeline(async (turns: TurnSignalInput[]) => {
      seen = turns;
      return new Map([[turn.trace_id, { novelty: 0.7, mismatch: 0.2 }]]);
    }).runSession('s1');

    const feature = db.getTurnFeature(turn.trace_id)!;
    expect(feature.novelty).toBeCloseTo(0.7);
    expect(feature.mismatch).toBeCloseTo(0.2);
    expect(seen[0].traceId).toBe(turn.trace_id);
    expect(seen[0].text).toContain('reflection');
    expect(typeof seen[0].cue).toBe('string');
  });

  test('a failing scorer does not fail the run', async () => {
    const turn = seed();
    const result = await pipeline(async () => {
      throw new Error('scorer down');
    }).runSession('s1');
    expect(result.archived).toBe(1);
    expect(result.failed).toBe(0);
    expect(db.getTurnFeature(turn.trace_id)!.novelty ?? null).toBeNull();
  });

  test('signals are on by default', () => {
    expect(config.recall.t1Signals).toBe('on');
  });
});
