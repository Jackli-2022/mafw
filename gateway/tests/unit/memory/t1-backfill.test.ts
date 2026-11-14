import { backfillT1Vectors } from '../../../src/memory/t1-backfill';
import { t1VectorKey } from '../../../src/recall/verbatim-recall';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { config } from '../../../src/config';

describe('GatewayDatabase.listT1RowsForBackfill', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-backfill-db-'));
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
    return t;
  }

  test('pages archive rows first, then active rows, across offsets', () => {
    const archived = turn('s1', 'archived row');
    db.archiveTurn('s1', archived.turn_seq);
    turn('s1', 'active row 1');
    turn('s1', 'active row 2');

    expect(db.listT1RowsForBackfill({ offset: 0, limit: 2 }).map((r) => r.content)).toEqual([
      'archived row',
      'active row 1',
    ]);
    expect(db.listT1RowsForBackfill({ offset: 1, limit: 5 }).map((r) => r.content)).toEqual([
      'active row 1',
      'active row 2',
    ]);
    expect(db.listT1RowsForBackfill({ offset: 0, limit: 0 })).toEqual([]);
  });
});

function row(sessionId: string, turnId: number, content: string) {
  return { observationKey: `t1o_${sessionId}_${turnId}`, sessionId, turnId, content };
}

function deps(rows: ReturnType<typeof row>[], existing: Set<string> = new Set()) {
  return {
    listRows: jest.fn((offset: number, limit: number) => rows.slice(offset, offset + limit)),
    hasVector: jest.fn((key: string) => existing.has(key)),
    enqueue: jest.fn(),
    flush: jest.fn(async () => ({ indexed: 1, failed: 0 })),
  };
}

describe('backfillT1Vectors', () => {
  test('enqueues only missing rows and reports counts', async () => {
    const rows = [
      row('s1', 1, 'first raw row'),
      row('s1', 2, 'second raw row'),
      row('s2', 1, 'third raw row'),
    ];
    const existing = new Set([t1VectorKey('s1', 1, 'first raw row')]);
    const d = deps(rows, existing);
    const res = await backfillT1Vectors(d, { pageSize: 10 });

    expect(res).toEqual({ scanned: 3, indexed: 2, missing: 0, failed: 0 });
    expect(d.enqueue).toHaveBeenCalledTimes(2);
    expect(d.enqueue).toHaveBeenCalledWith(
      t1VectorKey('s1', 2, 'second raw row'),
      'second raw row',
    );
    expect(d.flush).toHaveBeenCalledTimes(1);
  });

  test('stops at the limit and leaves the remainder for the next run', async () => {
    const rows = [row('s1', 1, 'aaa one'), row('s1', 2, 'bbb two'), row('s1', 3, 'ccc three')];
    const d = deps(rows);
    const res = await backfillT1Vectors(d, { limit: 1, pageSize: 2 });
    expect(res.indexed).toBe(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.flush).toHaveBeenCalledTimes(1);
  });

  test('caps embedded text at 2000 chars', async () => {
    const long = 'x'.repeat(2500);
    const d = deps([row('s1', 1, long)]);
    await backfillT1Vectors(d, {});
    expect((d.enqueue.mock.calls[0] as any[])[1]).toHaveLength(2000);
  });

  test('flush failure counts as failed and never throws', async () => {
    const d = deps([row('s1', 1, 'raw row')]);
    d.flush.mockRejectedValue(new Error('embed down'));
    const res = await backfillT1Vectors(d, {});
    expect(res).toEqual({ scanned: 1, indexed: 1, missing: 0, failed: 1 });
  });

  test('empty content counts as missing, not indexed', async () => {
    const d = deps([row('s1', 1, '')]);
    const res = await backfillT1Vectors(d, {});
    expect(res).toEqual({ scanned: 1, indexed: 0, missing: 1, failed: 0 });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  test('empty table returns zeroed counts without flushing', async () => {
    const d = deps([]);
    expect(await backfillT1Vectors(d, {})).toEqual({ scanned: 0, indexed: 0, missing: 0, failed: 0 });
    expect(d.flush).not.toHaveBeenCalled();
  });

  test('limit 0 disables backfill', async () => {
    const d = deps([row('s1', 1, 'raw')]);
    expect(await backfillT1Vectors(d, { limit: 0 })).toEqual({ scanned: 0, indexed: 0, missing: 0, failed: 0 });
    expect(d.listRows).not.toHaveBeenCalled();
  });

  test('the default daily limit outpaces observed archive growth', () => {
    // Production archive grew ~485 rows/day while the old default (200) could
    // never converge. 3k/day leaves headroom for catch-up without turning the
    // decay job into an embedding storm.
    expect(config.recall.t1Recall.t1BackfillLimit).toBeGreaterThanOrEqual(3000);
  });
});
