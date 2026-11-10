import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

const DAY = 86400;

describe('T1 trace activation state', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-state-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a retrieval event creates bounded state for a known trace', () => {
    const t = db.beginTurn('s1');
    db.recordT1RetrievalEvent({ traceId: t.trace_id, kind: 'search', score: 0.9 });
    const state = db.t1TraceActivation(t.trace_id)!;
    expect(state.activation).toBeCloseTo(0.1, 5);
    expect(state.retrievalCount).toBe(1);
    expect(state.lastRetrievedAt).toBeGreaterThan(0);
    expect(state.activationUpdatedAt).toBeGreaterThan(0);
  });

  test('activation is capped at 1 while retrieval_count keeps counting', () => {
    const t = db.beginTurn('s1');
    for (let i = 0; i < 12; i++) {
      db.recordT1RetrievalEvent({ traceId: t.trace_id, kind: 'recall' });
    }
    const state = db.t1TraceActivation(t.trace_id)!;
    expect(state.activation).toBe(1);
    expect(state.retrievalCount).toBe(12);
  });

  test('an unknown trace records the event but has no state row', () => {
    db.recordT1RetrievalEvent({ traceId: 't1t_missing', kind: 'search' });
    expect(db.t1TraceActivation('t1t_missing')).toBeNull();
    expect(db.t1RetrievalStats().total).toBe(1);
  });

  test('propagation touches only known traces', () => {
    const a = db.beginTurn('s1');
    const b = db.beginTurn('s2');
    const touched = db.propagateT1Activation([a.trace_id, b.trace_id, 't1t_missing'], 0.05);
    expect(touched).toBe(2);
    expect(db.t1TraceActivation(a.trace_id)!.activation).toBeCloseTo(0.05, 5);
    expect(db.t1TraceActivation(b.trace_id)!.activation).toBeCloseTo(0.05, 5);
    expect(db.t1TraceActivation('t1t_missing')).toBeNull();
  });

  test('daily decay halves activation after one half-life', () => {
    const t = db.beginTurn('s1');
    for (let i = 0; i < 5; i++) db.recordT1RetrievalEvent({ traceId: t.trace_id, kind: 'search' });
    const before = db.t1TraceActivation(t.trace_id)!;
    expect(before.activation).toBeCloseTo(0.5, 5);
    const changed = db.decayT1TraceState({
      now: before.activationUpdatedAt + 14 * DAY,
      halfLifeDays: 14,
    });
    expect(changed).toBe(1);
    expect(db.t1TraceActivation(t.trace_id)!.activation).toBeCloseTo(0.25, 3);
  });

  test('decay skips zero-activation rows and returns 0', () => {
    const t = db.beginTurn('s1');
    db.propagateT1Activation([t.trace_id], 0);
    expect(db.decayT1TraceState({ now: Math.floor(Date.now() / 1000) + DAY })).toBe(0);
    expect(db.t1TraceActivation(t.trace_id)!.activation).toBe(0);
  });

  test('activation stats report traces, mean and max', () => {
    const a = db.beginTurn('s1');
    const b = db.beginTurn('s2');
    db.propagateT1Activation([a.trace_id], 0.2);
    db.propagateT1Activation([b.trace_id], 0.1);
    const stats = db.t1ActivationStats();
    expect(stats.traces).toBe(2);
    expect(stats.mean).toBeCloseTo(0.15, 5);
    expect(stats.max).toBeCloseTo(0.2, 5);
  });

  test('batch activation lookup ignores unknown ids and caps input', () => {
    const a = db.beginTurn('s1');
    const b = db.beginTurn('s2');
    for (let i = 0; i < 5; i++) db.recordT1RetrievalEvent({ traceId: a.trace_id, kind: 'search' });
    for (let i = 0; i < 2; i++) db.recordT1RetrievalEvent({ traceId: b.trace_id, kind: 'recall' });

    const map = db.t1Activations([a.trace_id, b.trace_id, 't1t_missing']);
    expect(map.size).toBe(2);
    expect(map.get(a.trace_id)).toBeCloseTo(0.5, 5);
    expect(map.get(b.trace_id)).toBeCloseTo(0.2, 5);
    expect(db.t1Activations([]).size).toBe(0);

    const many = Array.from({ length: 150 }, (_, i) => `t1t_${i}`);
    expect(() => db.t1Activations(many)).not.toThrow();
  });
});
