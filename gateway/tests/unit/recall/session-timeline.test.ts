import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { readSessionTimeline } from '../../../src/recall/session-timeline';

describe('readSessionTimeline', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-timeline-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function turn(session: string, content: string) {
    const t = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: t.turn_seq,
      trace_id: t.trace_id,
      source: 'user_input',
      content,
      failure: 0,
    });
    db.append({
      session_id: session,
      turn_id: t.turn_seq,
      trace_id: t.trace_id,
      source: 'assistant_reply',
      content: `answer to ${content}`,
      failure: 0,
    });
    return t;
  }

  test('merges active and archived turns in turn_seq order', () => {
    const a = turn('s1', 'first');
    const b = turn('s1', 'second');
    db.archiveTurn('s1', a.turn_seq);

    const timeline = readSessionTimeline(db, 's1');
    expect(timeline.turns.map((t) => t.traceId)).toEqual([a.trace_id, b.trace_id]);
    expect(timeline.turns[0].archived).toBe(true);
    expect(timeline.turns[1].archived).toBe(false);
    expect(timeline.turns[0].summary).toContain('first');
  });

  test('uses the sparse feature when present', () => {
    const a = turn('s1', 'fix reflection');
    db.upsertTurnFeature({
      traceId: a.trace_id,
      sessionId: 's1',
      turnSeq: a.turn_seq,
      intent: 'fix reflection',
      action: 'read reflection.ts',
      error: 'unparseable',
      decision: 'adapter 前置 system',
      entities: ['reflection.ts'],
      outcome: 'unknown',
      confidence: 0.8,
    });

    const timeline = readSessionTimeline(db, 's1');
    expect(timeline.turns[0].feature).toMatchObject({
      intent: 'fix reflection',
      action: 'read reflection.ts',
      error: 'unparseable',
      decision: 'adapter 前置 system',
    });
  });

  test('filters by turnSeqs', () => {
    const a = turn('s1', 'first');
    const b = turn('s1', 'second');
    const timeline = readSessionTimeline(db, 's1', { turnSeqs: [b.turn_seq] });
    expect(timeline.turns.map((t) => t.traceId)).toEqual([b.trace_id]);
    expect(a.trace_id).not.toBe(b.trace_id);
  });

  test('truncates at the char budget', () => {
    turn('s1', 'a'.repeat(300));
    turn('s1', 'b'.repeat(300));
    const timeline = readSessionTimeline(db, 's1', { maxChars: 120 });
    expect(timeline.truncated).toBe(true);
    expect(timeline.turns.length).toBeGreaterThan(0);
    expect(timeline.chars).toBeLessThanOrEqual(120);
  });
});
