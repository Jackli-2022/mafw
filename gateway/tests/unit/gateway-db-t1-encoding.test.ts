import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { encodeT1Turn, type T1EncodeDeps } from '../../src/recall/t1-encode';

describe('GatewayDatabase T1 episode code', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-encoding-db-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function deps(): T1EncodeDeps {
    return {
      readTurnRows: (sessionId, turnSeq) => db.readTurnRows(sessionId, turnSeq),
      readTrajectoryEvents: (sessionId, turnSeq) =>
        db.readTrajectoryEvents(sessionId, turnSeq),
      upsertTurnActors: (traceId, actors) => db.upsertTurnActors(traceId, actors),
      upsertTurnConcepts: (traceId, concepts) => db.upsertTurnConcepts(traceId, concepts),
      upsertSparseTerms: (traceId, terms) => db.upsertSparseTerms(traceId, terms),
      upsertTurnEncoding: (marker) => db.upsertTurnEncoding(marker),
    };
  }

  function seedTurn(session: string, content: string) {
    const turn = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content,
      failure: 0,
    });
    return turn;
  }

  function recordEvent(
    session: string,
    turnSeq: number,
    seq: number,
    opts: { agent?: string; toolName?: string },
  ) {
    (db as any).db
      .prepare(
        `INSERT INTO trajectory_events
           (project_id, session_id, turn_id, seq, event_type, tool_name, agent, time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'p',
        session,
        turnSeq,
        seq,
        'tool',
        opts.toolName ?? null,
        opts.agent ?? null,
        Date.now(),
      );
  }

  test('roundtrips actors, concepts and sparse terms', () => {
    const turn = seedTurn('s1', '解析失败 unparseable JSON');
    recordEvent('s1', turn.turn_seq, 1, { agent: 'reviewer' });
    recordEvent('s1', turn.turn_seq, 2, { toolName: 'read' });

    const result = encodeT1Turn(
      { trace_id: turn.trace_id, session_id: 's1', turn_seq: turn.turn_seq },
      deps(),
    );

    expect(db.getTurnActors(turn.trace_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: 'user:local', role: 'requester' }),
        expect.objectContaining({ actorId: 'agent:reviewer', role: 'reviewer' }),
        expect.objectContaining({ actorId: 'tool:read', role: 'instrument' }),
      ]),
    );
    expect(db.getTurnConcepts(turn.trace_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conceptId: 'error:json_parse' }),
      ]),
    );
    expect(db.getSparseTerms(turn.trace_id).map((t) => t.termId)).toContain(
      'concept:error:json_parse',
    );
    expect(result.actors).toBeGreaterThanOrEqual(3);

    // The marker makes backfill converge.
    expect(db.listTurnsMissingEncoding(10)).toEqual([]);
  });

  test('re-encoding replaces the previous actor/concept/term set', () => {
    const turn = seedTurn('s1', 'reviewer changed the plan');
    recordEvent('s1', turn.turn_seq, 1, { agent: 'reviewer' });
    const ref = { trace_id: turn.trace_id, session_id: 's1', turn_seq: turn.turn_seq };
    encodeT1Turn(ref, deps());

    // Simulate a corrected trajectory / retracted actor set.
    db.upsertTurnActors(turn.trace_id, [
      { traceId: turn.trace_id, actorId: 'agent:builder', role: 'builder', weight: 1 },
    ]);
    db.upsertTurnConcepts(turn.trace_id, []);
    db.upsertSparseTerms(turn.trace_id, []);

    expect(db.getTurnActors(turn.trace_id)).toEqual([
      expect.objectContaining({ actorId: 'agent:builder', role: 'builder' }),
    ]);
    expect(db.getTurnConcepts(turn.trace_id)).toEqual([]);
    expect(db.getSparseTerms(turn.trace_id)).toEqual([]);
  });

  test('concept channel resolves a Chinese synonym query', () => {
    const turn = seedTurn('s1', 'reflection unparseable JSON');
    encodeT1Turn(
      { trace_id: turn.trace_id, session_id: 's1', turn_seq: turn.turn_seq },
      deps(),
    );

    const hits = db.searchT1Concepts('解析失败', 5);
    expect(hits.map((h) => h.traceId)).toEqual([turn.trace_id]);
    expect(hits[0].source).toBe('concept');
    expect(db.searchT1Concepts('weather tomorrow', 5)).toEqual([]);
  });

  test('actor channel uses AND semantics for multi-actor queries', () => {
    const both = seedTurn('s1', 'reviewer and builder disagree on embedding');
    recordEvent('s1', both.turn_seq, 1, { agent: 'reviewer' });
    recordEvent('s1', both.turn_seq, 2, { agent: 'builder' });
    const reviewerOnly = seedTurn('s2', 'reviewer approved the plan');
    recordEvent('s2', reviewerOnly.turn_seq, 1, { agent: 'reviewer' });

    for (const turn of [both, reviewerOnly]) {
      encodeT1Turn(
        { trace_id: turn.trace_id, session_id: turn.session_id, turn_seq: turn.turn_seq },
        deps(),
      );
    }

    const pair = db.searchT1Actors('reviewer builder', 5);
    expect(pair.map((h) => h.traceId)).toEqual([both.trace_id]);

    const reviewer = db.searchT1Actors('reviewer', 5);
    expect(reviewer.map((h) => h.traceId).sort()).toEqual(
      [both.trace_id, reviewerOnly.trace_id].sort(),
    );
  });

  test('actor channel falls back to a bounded session window for cross-turn episodes', () => {
    const reviewerTurn = seedTurn('s1', 'reviewer opened the discussion');
    recordEvent('s1', reviewerTurn.turn_seq, 1, { agent: 'reviewer' });
    const builderTurn = seedTurn('s1', 'builder pushed the embedding change');
    recordEvent('s1', builderTurn.turn_seq, 1, { agent: 'builder' });

    for (const turn of [reviewerTurn, builderTurn]) {
      encodeT1Turn(
        { trace_id: turn.trace_id, session_id: 's1', turn_seq: turn.turn_seq },
        deps(),
      );
    }

    const hits = db.searchT1Actors('reviewer builder', 5);
    expect(hits.map((h) => h.traceId)).toContain(builderTurn.trace_id);
  });

  test('sparse channel finds concept and exact-token hits', () => {
    const conceptTurn = seedTurn('s1', 'unparseable JSON in reflection');
    const tokenTurn = seedTurn('s2', 'embedding sidecar ECONNRESET');
    for (const turn of [conceptTurn, tokenTurn]) {
      encodeT1Turn(
        { trace_id: turn.trace_id, session_id: turn.session_id, turn_seq: turn.turn_seq },
        deps(),
      );
    }

    expect(db.searchT1Sparse('解析失败', 5).map((h) => h.traceId)).toContain(
      conceptTurn.trace_id,
    );
    expect(db.searchT1Sparse('ECONNRESET', 5).map((h) => h.traceId)).toContain(
      tokenTurn.trace_id,
    );
    expect(db.searchT1Sparse('weather tomorrow', 5)).toEqual([]);
  });

  test('pattern completion expands a seed through shared concepts', () => {
    const seed = seedTurn('s1', 'consolidation 合并太多');
    const neighbor = seedTurn('s1', 'merge 后再 soft supersede');
    const unrelated = seedTurn('s2', 'weather tomorrow');

    for (const turn of [seed, neighbor, unrelated]) {
      encodeT1Turn(
        { trace_id: turn.trace_id, session_id: turn.session_id, turn_seq: turn.turn_seq },
        deps(),
      );
    }

    const expanded = db.expandT1Neighbors([seed.trace_id], 5);
    expect(expanded.map((h) => h.traceId)).toContain(neighbor.trace_id);
    expect(expanded.map((h) => h.traceId)).not.toContain(unrelated.trace_id);
    expect(expanded[0].source).toBe('neighbor');
  });

  test('pattern completion includes same-session adjacent turns', () => {
    const seed = seedTurn('s1', 'alpha');
    const adjacent = seedTurn('s1', 'beta');
    for (const turn of [seed, adjacent]) {
      encodeT1Turn(
        { trace_id: turn.trace_id, session_id: 's1', turn_seq: turn.turn_seq },
        deps(),
      );
    }
    expect(db.expandT1Neighbors([seed.trace_id], 5).map((h) => h.traceId)).toEqual([
      adjacent.trace_id,
    ]);
  });

  test('pattern completion ignores the generic user actor', () => {
    const seed = seedTurn('s1', 'alpha');
    const other = seedTurn('s2', 'beta');
    for (const turn of [seed, other]) {
      encodeT1Turn(
        { trace_id: turn.trace_id, session_id: turn.session_id, turn_seq: turn.turn_seq },
        deps(),
      );
    }
    expect(db.expandT1Neighbors([seed.trace_id], 5)).toEqual([]);
  });
});
