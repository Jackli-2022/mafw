import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { backfillT1Atoms } from '../../../src/recall/t1-atom-backfill';

describe('T1 turn-code + atom backfill', () => {
  let dir: string;
  let db: GatewayDatabase;
  const traceIds: string[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-atom-backfill-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    traceIds.length = 0;
    for (const content of ['解析失败', 'hello world', 'x']) {
      const turn = db.beginTurn('s1');
      db.append({
        session_id: 's1',
        turn_id: turn.turn_seq,
        trace_id: turn.trace_id,
        source: 'user_input',
        content,
        failure: 0,
      });
      traceIds.push(turn.trace_id);
    }
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fakeAtoms = async () =>
    new Map([
      [traceIds[0], [{ termId: 'error:json_parse', score: 0.2 }]],
      [traceIds[2], [{ termId: 'action:merge', score: 0.1 }]],
    ]);

  test('is bounded, converges, and writes the whole turn code', async () => {
    const first = await backfillT1Atoms(db, fakeAtoms, { limit: 2 });
    expect(first).toMatchObject({ scanned: 2, encoded: 2, failed: 0 });
    expect(first.sessionIds).toEqual(['s1']);

    const second = await backfillT1Atoms(db, fakeAtoms, { limit: 2 });
    expect(second).toMatchObject({ scanned: 1, encoded: 1, failed: 0 });

    expect((await backfillT1Atoms(db, fakeAtoms, { limit: 2 })).scanned).toBe(0);

    const firstTerms = db.getSparseTerms(traceIds[0]).map((term) => term.termId);
    expect(firstTerms).toContain('sem:error:json_parse');
    expect(firstTerms).toContain('concept:error:json_parse');

    const stats = db.t1CodeStats();
    expect(stats).toMatchObject({ turns: 3, features: 3, atoms: 2 });
    expect(stats.actors).toBeGreaterThanOrEqual(0);
    expect(stats.concepts).toBeGreaterThanOrEqual(1);
  });

  test('a turn with zero atoms is marked and not rescanned', async () => {
    await backfillT1Atoms(db, async () => new Map(), { limit: 10 });
    const marker = db
      .getStore()
      .prepare('SELECT model FROM t1_turn_encoding WHERE trace_id = ?')
      .get(traceIds[1]) as { model?: string } | undefined;
    expect(marker?.model).toBe('sparse-embed-v1');
    expect((await backfillT1Atoms(db, async () => new Map(), { limit: 10 })).scanned).toBe(0);
  });

  test('an encoder failure still writes lexical code and does not abort the pass', async () => {
    const result = await backfillT1Atoms(
      db,
      async () => {
        throw new Error('embedding down');
      },
      { limit: 10 },
    );
    expect(result).toMatchObject({ scanned: 3, encoded: 3, failed: 0 });
    expect(db.getSparseTerms(traceIds[0]).some((term) => term.kind === 'concept')).toBe(true);
  });
});
