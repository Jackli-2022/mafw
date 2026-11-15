import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { backfillT1Features } from '../../src/recall/t1-features';

describe('GatewayDatabase T1 turn features', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-features-db-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedTurn(session = 's1') {
    const turn = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content: `fix ${session}`,
      failure: 0,
    });
    return turn;
  }

  test('upsert + get roundtrip', () => {
    const turn = seedTurn();
    db.upsertTurnFeature({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnSeq: turn.turn_seq,
      intent: 'fix reflection',
      action: 'read reflection.ts',
      tool: 'read',
      target: 'reflection.ts',
      result: 'done',
      error: 'unparseable',
      decision: 'adapter 前置 system',
      entities: ['reflection.ts', 'parseInsights'],
      outcome: 'unknown',
      confidence: 0.7,
    });

    expect(db.getTurnFeature(turn.trace_id)).toMatchObject({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnSeq: turn.turn_seq,
      intent: 'fix reflection',
      action: 'read reflection.ts',
      tool: 'read',
      target: 'reflection.ts',
      error: 'unparseable',
      decision: 'adapter 前置 system',
      entities: ['reflection.ts', 'parseInsights'],
      outcome: 'unknown',
      confidence: 0.7,
    });
  });

  test('upsert replaces an existing feature', () => {
    const turn = seedTurn();
    db.upsertTurnFeature({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnSeq: turn.turn_seq,
      intent: 'old',
      entities: [],
      outcome: 'unknown',
      confidence: 0.4,
    });
    db.upsertTurnFeature({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnSeq: turn.turn_seq,
      intent: 'new',
      entities: ['x'],
      outcome: 'pass',
      confidence: 0.9,
    });
    const feature = db.getTurnFeature(turn.trace_id)!;
    expect(feature.intent).toBe('new');
    expect(feature.entities).toEqual(['x']);
    expect(feature.outcome).toBe('pass');
  });

  test('unknown trace returns null', () => {
    expect(db.getTurnFeature('t1t_missing')).toBeNull();
  });

  test('listSessionTurns returns turns ordered by turn_seq', () => {
    const a = seedTurn('s1');
    const b = seedTurn('s1');
    const other = seedTurn('s2');
    expect(db.listSessionTurns('s1').map((t) => t.turn_seq)).toEqual([a.turn_seq, b.turn_seq]);
    expect(db.listSessionTurns('s2').map((t) => t.trace_id)).toEqual([other.trace_id]);
  });

  test('readTurnRows merges archive and active rows in replay order', () => {
    const turn = seedTurn();
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'assistant_reply',
      content: 'first answer',
      failure: 0,
    });
    db.archiveTurn('s1', turn.turn_seq);
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'tool_result',
      content: 'late tool row',
      failure: 0,
    });

    const rows = db.readTurnRows('s1', turn.turn_seq);
    expect(rows.map((r) => r.content)).toEqual([
      'fix s1',
      'first answer',
      'late tool row',
    ]);
  });

  test('invalid entities_json degrades to an empty array', () => {
    const turn = seedTurn();
    (db as any).db.prepare(
      `INSERT INTO t1_turn_features (trace_id, session_id, turn_seq, entities_json, outcome, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(turn.trace_id, 's1', turn.turn_seq, 'not-json', 'unknown', 0.5, 1, 1);
    expect(db.getTurnFeature(turn.trace_id)!.entities).toEqual([]);
  });

  test('listTurnsMissingFeatures skips empty turns and already-built features', () => {
    const missing = seedTurn('s1');
    const built = seedTurn('s1');
    db.upsertTurnFeature({
      traceId: built.trace_id,
      sessionId: 's1',
      turnSeq: built.turn_seq,
      intent: 'done',
      entities: [],
      outcome: 'unknown',
      confidence: 0.5,
    });
    db.beginTurn('s2'); // no observations

    expect(db.listTurnsMissingFeatures(10).map((t) => t.trace_id)).toEqual([missing.trace_id]);
  });

  test('backfillT1Features writes missing features and converges', () => {
    const turn = seedTurn('s1');
    const deps = {
      listTurnsMissingFeatures: (limit: number) => db.listTurnsMissingFeatures(limit),
      readTurnRows: (sessionId: string, turnSeq: number) => db.readTurnRows(sessionId, turnSeq),
      upsertTurnFeature: (feature: Parameters<GatewayDatabase['upsertTurnFeature']>[0]) =>
        db.upsertTurnFeature(feature),
    };

    expect(backfillT1Features(deps, { limit: 10 })).toEqual({
      scanned: 1,
      written: 1,
      skipped: 0,
      failed: 0,
    });
    expect(db.getTurnFeature(turn.trace_id)!.intent).toContain('fix s1');
    expect(backfillT1Features(deps, { limit: 10 }).scanned).toBe(0);
  });

  test('searchT1Features indexes intent/action/error/entities and stays in sync', () => {
    const turn = seedTurn('s1');
    db.upsertTurnFeature({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnSeq: turn.turn_seq,
      intent: 'fix reflection',
      action: 'read reflection.ts',
      error: 'unparseable JSON',
      decision: 'adapter 前置 system',
      entities: ['reflection.ts', 'parseInsights'],
      outcome: 'unknown',
      confidence: 0.8,
    });

    expect(db.searchT1Features('reflection', 5).map((h) => h.traceId)).toContain(turn.trace_id);
    expect(db.searchT1Features('unparseable', 5).map((h) => h.traceId)).toContain(turn.trace_id);
    expect(db.searchT1Features('parseInsights', 5).map((h) => h.traceId)).toContain(turn.trace_id);

    db.upsertTurnFeature({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnSeq: turn.turn_seq,
      intent: 'coverage backlog',
      entities: ['coverage'],
      outcome: 'unknown',
      confidence: 0.8,
    });
    expect(db.searchT1Features('reflection', 5)).toHaveLength(0);
    expect(db.searchT1Features('coverage', 5).map((h) => h.traceId)).toContain(turn.trace_id);
  });
});
