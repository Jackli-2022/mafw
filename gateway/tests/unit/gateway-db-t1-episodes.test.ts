import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { episodeIdFor, type T1EpisodeRecord } from '../../src/recall/t1-episodes';

describe('GatewayDatabase T1 episodes', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-episodes-db-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function ep(over: Partial<T1EpisodeRecord>): T1EpisodeRecord {
    return {
      episodeId: episodeIdFor('s1', 1),
      sessionId: 's1',
      startTurn: 1,
      endTurn: 1,
      status: 'open',
      startedAt: 1,
      endedAt: null,
      boundarySource: 'inferred',
      boundaryReason: 'actor_shift',
      confidence: 0.8,
      actors: [],
      conceptIds: [],
      sourceTraceIds: [],
      ...over,
    };
  }

  test('boundary roundtrip + pending flag consumed once', () => {
    db.recordEpisodeBoundary({
      sessionId: 's1',
      afterTurn: 3,
      source: 'agent',
      reason: 'agent_declared',
      createdAt: 1,
    });
    db.setPendingEpisodeBoundary('s1', { reason: 'user_declared', createdAt: 2 });

    expect(db.consumePendingEpisodeBoundary('s1', 5)).toMatchObject({
      afterTurn: 4,
      source: 'user',
      reason: 'user_declared',
    });
    expect(db.consumePendingEpisodeBoundary('s1', 6)).toBeNull();
    expect(db.listEpisodeBoundaries('s1').map((b) => b.afterTurn)).toEqual([3, 4]);
  });

  test('replaceSessionEpisodes is idempotent and episodeId is startTurn-only', () => {
    const id = episodeIdFor('s1', 2);
    db.replaceSessionEpisodes(
      's1',
      [ep({ episodeId: id, startTurn: 2, endTurn: 3, actors: [{ actorId: 'agent:reviewer', role: 'reviewer', weight: 1 }] })],
      [{ episodeId: id, traceId: 't1t_a', turnSeq: 2 }],
    );
    db.replaceSessionEpisodes(
      's1',
      [ep({ episodeId: id, startTurn: 2, endTurn: 4, actors: [{ actorId: 'agent:builder', role: 'builder', weight: 1 }] })],
      [
        { episodeId: id, traceId: 't1t_a', turnSeq: 2 },
        { episodeId: id, traceId: 't1t_b', turnSeq: 3 },
      ],
    );

    const stored = db.getEpisode(id)!;
    expect(stored.endTurn).toBe(4);
    expect(stored.actors).toEqual([{ actorId: 'agent:builder', role: 'builder', weight: 1 }]);
    expect(db.listEpisodeMembers(id)).toHaveLength(2);
    expect(db.findEpisodeByTrace('t1t_b')).toBe(id);
    expect(db.findEpisodeByTrace('t1t_missing')).toBeNull();
  });

  test('listEpisodes paginates by started_at/episodeId and filters by session', () => {
    const a = episodeIdFor('s1', 1);
    const b = episodeIdFor('s2', 1);
    const c = episodeIdFor('s1', 5);
    db.replaceSessionEpisodes('s1', [
      ep({ episodeId: a, sessionId: 's1', startTurn: 1, endTurn: 2, startedAt: 10 }),
      ep({ episodeId: c, sessionId: 's1', startTurn: 5, endTurn: 6, startedAt: 30 }),
    ], [
      { episodeId: a, traceId: 't1t_a', turnSeq: 1 },
      { episodeId: c, traceId: 't1t_c', turnSeq: 5 },
    ]);
    db.replaceSessionEpisodes('s2', [
      ep({ episodeId: b, sessionId: 's2', startTurn: 1, endTurn: 2, startedAt: 20 }),
    ], [{ episodeId: b, traceId: 't1t_b', turnSeq: 1 }]);

    const first = db.listEpisodes({ limit: 2 });
    expect(first.episodes.map((e) => e.episodeId)).toEqual([c, b]);
    expect(first.nextCursor).toBeTruthy();

    const second = db.listEpisodes({ limit: 2, cursor: first.nextCursor });
    expect(second.episodes.map((e) => e.episodeId)).toEqual([a]);

    expect(db.listEpisodes({ sessionId: 's1', limit: 10 }).episodes.map((e) => e.episodeId)).toEqual([c, a]);
  });

  test('episodeIdFor is deterministic and scoped by session + startTurn', () => {
    expect(episodeIdFor('s1', 2)).toBe(episodeIdFor('s1', 2));
    expect(episodeIdFor('s1', 2)).not.toBe(episodeIdFor('s1', 3));
    expect(episodeIdFor('s1', 2)).not.toBe(episodeIdFor('s2', 2));
    expect(episodeIdFor('s1', 2)).toMatch(/^t1ep_[0-9a-f]{20}$/);
  });
});
