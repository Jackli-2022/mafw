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

  test('does not let NULL observation_key archive rows shift the page boundary', () => {
    const a = turn('s1', 'archive A');
    db.archiveTurn('s1', a.turn_seq);
    const gap = turn('s1', 'archive NULL');
    db.archiveTurn('s1', gap.turn_seq);
    const b = turn('s1', 'archive B');
    db.archiveTurn('s1', b.turn_seq);
    turn('s1', 'active C');

    // Only this test row loses its key. It cannot be embedded, so it must not
    // be counted when deciding where the archive region ends: counting it
    // shifts the archive→active handoff and repeats an active row.
    (db as any).db
      .prepare('UPDATE t1_archive SET observation_key = NULL WHERE content = ?')
      .run('archive NULL');

    const page = (offset: number) =>
      db.listT1RowsForBackfill({ offset, limit: 1 }).map((r) => r.content);

    expect([page(0), page(1), page(2)]).toEqual([['archive A'], ['archive B'], ['active C']]);
    // Past the last real row the walk ends; it must not replay 'active C'.
    expect(page(3)).toEqual([]);

    // A full page walk yields each row exactly once and never reads the NULL row.
    const walked: string[] = [];
    for (let offset = 0; offset < 10; offset++) {
      const rows = db.listT1RowsForBackfill({ offset, limit: 1 });
      if (rows.length === 0) break;
      walked.push(...rows.map((r) => r.content));
    }
    expect(walked).toEqual(['archive A', 'archive B', 'active C']);
  });
});

function row(sessionId: string, turnId: number, content: string) {
  return { observationKey: `t1o_${sessionId}_${turnId}`, sessionId, turnId, content };
}

function deps(rows: ReturnType<typeof row>[], existing: Set<string> = new Set()) {
  const enqueued: string[] = [];
  return {
    listRows: jest.fn((offset: number, limit: number) => rows.slice(offset, offset + limit)),
    hasVector: jest.fn((key: string) => existing.has(key)),
    enqueue: jest.fn((key: string) => {
      enqueued.push(key);
    }),
    flush: jest.fn(async () => ({ indexed: enqueued.length, failed: 0 })),
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

    expect(res).toEqual({ scanned: 3, queued: 2, indexed: 2, missing: 0, failed: 0 });
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
    expect(res.queued).toBe(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.flush).toHaveBeenCalledTimes(1);
  });

  test('caps embedded text at 2000 chars', async () => {
    const long = 'x'.repeat(2500);
    const d = deps([row('s1', 1, long)]);
    await backfillT1Vectors(d, {});
    expect((d.enqueue.mock.calls[0] as any[])[1]).toHaveLength(2000);
  });

  test('flush reports partial success without over-reporting indexed', async () => {
    const d = deps([row('s1', 1, 'raw one'), row('s1', 2, 'raw two')]);
    d.flush.mockResolvedValueOnce({ indexed: 1, failed: 1 });
    const res = await backfillT1Vectors(d, {});
    expect(res).toEqual({ scanned: 2, queued: 2, indexed: 1, missing: 0, failed: 1 });
  });

  test('flush failure counts as failed and never throws', async () => {
    const d = deps([row('s1', 1, 'raw row')]);
    d.flush.mockRejectedValue(new Error('embed down'));
    const res = await backfillT1Vectors(d, {});
    expect(res).toEqual({ scanned: 1, queued: 1, indexed: 0, missing: 0, failed: 1 });
  });

  test('empty content counts as missing, not indexed', async () => {
    const d = deps([row('s1', 1, '')]);
    const res = await backfillT1Vectors(d, {});
    expect(res).toEqual({ scanned: 1, queued: 0, indexed: 0, missing: 1, failed: 0 });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  test('empty table returns zeroed counts without flushing', async () => {
    const d = deps([]);
    expect(await backfillT1Vectors(d, {})).toEqual({
      scanned: 0,
      queued: 0,
      indexed: 0,
      missing: 0,
      failed: 0,
    });
    expect(d.flush).not.toHaveBeenCalled();
  });

  test('limit 0 disables backfill', async () => {
    const d = deps([row('s1', 1, 'raw')]);
    expect(await backfillT1Vectors(d, { limit: 0 })).toEqual({
      scanned: 0,
      queued: 0,
      indexed: 0,
      missing: 0,
      failed: 0,
    });
    expect(d.listRows).not.toHaveBeenCalled();
  });

  test('the default daily limit outpaces observed archive growth', () => {
    // Production archive grew ~485 rows/day while the old default (200) could
    // never converge. 3k/day leaves headroom for catch-up without turning the
    // decay job into an embedding storm.
    expect(config.recall.t1Recall.t1BackfillLimit).toBeGreaterThanOrEqual(3000);
  });
});
