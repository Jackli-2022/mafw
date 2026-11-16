import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { encodeT1Turn } from '../../../src/recall/t1-encode';
import { extractTurnFeature } from '../../../src/recall/t1-features';
import { episodeIdFor } from '../../../src/recall/t1-episodes';
import {
  rebuildSessionEpisodes,
  readSessionEpisodeTurns,
} from '../../../src/recall/t1-episode-rebuild';

describe('T1 episode rebuild', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-episode-rebuild-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(content: string, session = 's1', agent?: string) {
    const turn = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content,
      failure: 0,
    });
    if (agent) {
      db.getStore()
        .prepare(
          `INSERT INTO trajectory_events
             (project_id, session_id, turn_id, seq, event_type, agent, time_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('p', session, turn.turn_seq, 1, 'tool', agent, Date.now());
    }
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

  test('builds ranges from declared boundaries and keeps IDs stable', () => {
    const a = seed('review the embedding change');
    const b = seed('reviewer asks for baseline evidence');
    db.recordEpisodeBoundary({
      sessionId: 's1',
      afterTurn: b.turn_seq,
      source: 'agent',
      reason: 'agent_declared',
      createdAt: 1,
    });
    const c = seed('builder adds the concept channel');
    const d = seed('builder runs the baseline');

    const first = rebuildSessionEpisodes(db, 's1', { now: Date.now() })!;
    expect(first.episodes.map((e) => [e.startTurn, e.endTurn])).toEqual([
      [a.turn_seq, b.turn_seq],
      [c.turn_seq, d.turn_seq],
    ]);
    expect(first.episodes[0].episodeId).toBe(episodeIdFor('s1', a.turn_seq));
    expect(first.episodes[1].episodeId).toBe(episodeIdFor('s1', c.turn_seq));
    expect(first.episodes[0].sourceTraceIds).toEqual([a.trace_id, b.trace_id]);
    expect(first.episodes[0].status).toBe('closed');

    const second = rebuildSessionEpisodes(db, 's1', { now: Date.now() })!;
    expect(second.episodes.map((e) => e.episodeId)).toEqual(first.episodes.map((e) => e.episodeId));
  });

  test('rebuild sees archived turns', () => {
    const a = seed('alpha');
    const b = seed('beta');
    db.archiveTurn('s1', a.turn_seq);

    const out = rebuildSessionEpisodes(db, 's1', { now: Date.now() })!;
    expect(out.episodes[0].startTurn).toBe(a.turn_seq);
    expect(out.episodes[0].endTurn).toBe(b.turn_seq);
    expect(out.episodes[0].sourceTraceIds).toEqual([a.trace_id, b.trace_id]);
  });

  test('readSessionEpisodeTurns exposes actors, concepts and derived fields', () => {
    const turn = seed('解析失败 reviewer 的改动', 's1', 'reviewer');
    const rows = readSessionEpisodeTurns(db, 's1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      traceId: turn.trace_id,
      turnSeq: turn.turn_seq,
      isUserTurn: true,
    });
    expect(rows[0].specificActors).toContain('agent:reviewer');
    expect(rows[0].conceptIds).toContain('error:json_parse');
    expect(rows[0].intent).toBeTruthy();
  });

  test('idle tail is closed with session_end', () => {
    seed('alpha');
    const out = rebuildSessionEpisodes(db, 's1', {
      now: Date.now() + 7 * 3600_000,
    })!;
    expect(out.episodes[0]).toMatchObject({
      status: 'closed',
      boundarySource: 'session_end',
      boundaryReason: 'idle_timeout',
    });
  });

  test('returns null for a session with no turns', () => {
    expect(rebuildSessionEpisodes(db, 'missing', { now: Date.now() })).toBeNull();
  });
});
