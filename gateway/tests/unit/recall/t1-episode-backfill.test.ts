import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { encodeT1Turn } from '../../../src/recall/t1-encode';
import { extractTurnFeature } from '../../../src/recall/t1-features';
import {
  backfillT1Episodes,
  closeIdleEpisodes,
  rebuildSessionEpisodes,
} from '../../../src/recall/t1-episode-rebuild';

describe('T1 episode backfill and idle close', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-episode-backfill-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(session: string, content: string) {
    const turn = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content,
      failure: 0,
    });
    encodeT1Turn({ trace_id: turn.trace_id, session_id: session, turn_seq: turn.turn_seq }, {
      readTurnRows: (s, t) => db.readTurnRows(s, t),
      readTrajectoryEvents: (s, t) => db.readTrajectoryEvents(s, t),
      upsertTurnActors: (id, actors) => db.upsertTurnActors(id, actors),
      upsertTurnConcepts: (id, concepts) => db.upsertTurnConcepts(id, concepts),
      upsertSparseTerms: (id, terms) => db.upsertSparseTerms(id, terms),
      upsertTurnEncoding: (marker) => db.upsertTurnEncoding(marker),
    });
    const feature = extractTurnFeature(
      { trace_id: turn.trace_id, session_id: session, turn_seq: turn.turn_seq },
      db.readTurnRows(session, turn.turn_seq),
    );
    if (feature) db.upsertTurnFeature(feature);
    return turn;
  }

  test('backfill is bounded per call and converges', () => {
    seed('s1', 'alpha');
    seed('s2', 'beta');
    seed('s3', 'gamma');

    expect(backfillT1Episodes(db, { limit: 2, now: Date.now() })).toMatchObject({
      scanned: 2,
      rebuilt: 2,
      failed: 0,
    });
    expect(backfillT1Episodes(db, { limit: 2, now: Date.now() })).toMatchObject({
      scanned: 1,
      rebuilt: 1,
    });
    expect(backfillT1Episodes(db, { limit: 2, now: Date.now() }).scanned).toBe(0);
  });

  test('closeIdleEpisodes closes only stale open episodes', () => {
    const now = Date.now();
    seed('s1', 'alpha');
    rebuildSessionEpisodes(db, 's1', { now });
    expect(db.listEpisodes({ sessionId: 's1', limit: 10 }).episodes[0].status).toBe('open');

    expect(closeIdleEpisodes(db, { idleMs: 6 * 3600_000, now: now + 7 * 3600_000 })).toBe(1);
    const closed = db.listEpisodes({ sessionId: 's1', limit: 10 }).episodes[0];
    expect(closed).toMatchObject({
      status: 'closed',
      boundarySource: 'session_end',
      boundaryReason: 'idle_timeout',
    });
    expect(closeIdleEpisodes(db, { idleMs: 6 * 3600_000, now: now + 8 * 3600_000 })).toBe(0);
  });

  test('shadow log writes one JSON line per episode', () => {
    seed('s1', 'alpha');
    const logPath = path.join(dir, 'episode-shadow.jsonl');
    rebuildSessionEpisodes(db, 's1', { now: Date.now(), shadowLogPath: logPath });
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]);
    expect(row).toMatchObject({ sessionId: 's1', boundarySource: 'session_start' });
  });
});
