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
      content: '淇竴涓?reflection 鐨勮竟鐣?recall',
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

  function pipeline(signalsFor: any, surpriseFor?: any) {
    return new TurnPipeline({
      t1db: db,
      index: { getIndex: () => ({ entries: [] }) } as any,
      workerFor: () => ({ prompt: async () => '[EXTRACTED: 0]' }) as any,
      staleMs: 60_000,
      signalsFor,
      surpriseFor,
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

  test('writes session surprise for the turn with a predecessor', async () => {
    const first = seed();
    const second = db.beginTurn('s1');
    db.append({
      session_id: 's1',
      turn_id: second.turn_seq,
      trace_id: second.trace_id,
      source: 'user_input',
      content: '继续修 reflection 的边界 recall',
      failure: 0,
    });
    db.append({
      session_id: 's1',
      turn_id: second.turn_seq,
      trace_id: second.trace_id,
      source: 'tool_result',
      content: 'read reflection.ts again',
      failure: 0,
    });
    let seen: any[] = [];
    await pipeline(undefined, async (turns: any[]) => {
      seen = turns;
      return new Map([[second.trace_id, 0.42]]);
    }).runSession('s1');

    expect(db.getTurnFeature(second.trace_id)!.surprise).toBeCloseTo(0.42);
    expect(db.getTurnFeature(first.trace_id)!.surprise ?? null).toBeNull();
    expect(seen[0].prevText).toContain('reflection');
  });

  test('a failing surprise scorer does not fail the run', async () => {
    const first = seed();
    const second = db.beginTurn('s1');
    db.append({
      session_id: 's1',
      turn_id: second.turn_seq,
      trace_id: second.trace_id,
      source: 'user_input',
      content: '再修一次 reflection',
      failure: 0,
    });
    db.append({
      session_id: 's1',
      turn_id: second.turn_seq,
      trace_id: second.trace_id,
      source: 'tool_result',
      content: 'read reflection.ts once more',
      failure: 0,
    });
    const result = await pipeline(undefined, async () => {
      throw new Error('surprise down');
    }).runSession('s1');
    expect(result.archived).toBe(2);
    expect(result.failed).toBe(0);
    expect(db.getTurnFeature(second.trace_id)!.surprise ?? null).toBeNull();
  });
});
