import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

describe('t1 turn signal columns', () => {
  let dir: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-signal-cols-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const feature = (over: Record<string, unknown> = {}) => ({
    traceId: 't1t_a',
    sessionId: 's1',
    turnSeq: 1,
    entities: [],
    outcome: 'pass' as const,
    confidence: 0.6,
    ...over,
  });

  test('roundtrips novelty and mismatch', () => {
    db.upsertTurnFeature(feature({ novelty: 0.42, mismatch: 0.11 }) as any);
    const row = db.getTurnFeature('t1t_a')!;
    expect(row.novelty).toBeCloseTo(0.42);
    expect(row.mismatch).toBeCloseTo(0.11);
  });

  test('re-upsert without signals preserves the previous values', () => {
    db.upsertTurnFeature(feature({ novelty: 0.42, mismatch: 0.11 }) as any);
    db.upsertTurnFeature(feature({ intent: 're-encoded' }) as any);
    const row = db.getTurnFeature('t1t_a')!;
    expect(row.intent).toBe('re-encoded');
    expect(row.novelty).toBeCloseTo(0.42);
    expect(row.mismatch).toBeCloseTo(0.11);
  });

  test('explicit new signals overwrite', () => {
    db.upsertTurnFeature(feature({ novelty: 0.42, mismatch: 0.11 }) as any);
    db.upsertTurnFeature(feature({ novelty: 0.9, mismatch: 0.3 }) as any);
    const row = db.getTurnFeature('t1t_a')!;
    expect(row.novelty).toBeCloseTo(0.9);
    expect(row.mismatch).toBeCloseTo(0.3);
  });
});
