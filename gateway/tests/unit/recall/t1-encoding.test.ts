import {
  extractTurnActors,
  parseActorQuery,
} from '../../../src/recall/t1-actors';
import {
  expandQueryConcepts,
  extractTurnConcepts,
  matchConcepts,
} from '../../../src/recall/t1-concepts';
import {
  encodeTurnSparseTerms,
  querySparseTermIds,
} from '../../../src/recall/t1-sparse';
import { encodeT1Turn } from '../../../src/recall/t1-encode';

const turn = { trace_id: 't1t_a', session_id: 's1', turn_seq: 1 };

function row(source: 'user_input' | 'assistant_reply' | 'tool_result', content: string) {
  return { source, content };
}

describe('extractTurnActors', () => {
  test('collects user, canonical agent roles and tools deterministically', () => {
    const actors = extractTurnActors(
      turn,
      [row('user_input', 'reviewer 说 builder 的 embedding 改动不行')],
      [
        { agent: 'reviewer' },
        { agent: 'builder' },
        { agent: 'reviewer' },
        { toolName: 'read' },
      ],
    );

    expect(actors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: 'user:local', role: 'requester', weight: 1 }),
        expect.objectContaining({ actorId: 'agent:reviewer', role: 'reviewer' }),
        expect.objectContaining({ actorId: 'agent:builder', role: 'builder' }),
        expect.objectContaining({ actorId: 'tool:read', role: 'instrument' }),
      ]),
    );
    expect(actors.filter((a) => a.actorId === 'agent:reviewer')).toHaveLength(1);
  });

  test('unknown agent names stay canonical and are subjects', () => {
    const actors = extractTurnActors(turn, [], [{ agent: 'Memory Curator' }]);
    expect(actors).toContainEqual(
      expect.objectContaining({ actorId: 'agent:memory-curator', role: 'subject' }),
    );
  });

  test('a generic build agent is not promoted to builder', () => {
    const actors = extractTurnActors(turn, [], [{ agent: 'build' }]);
    expect(actors).toContainEqual(
      expect.objectContaining({ actorId: 'agent:build', role: 'subject' }),
    );
    expect(actors.some((a) => a.actorId === 'agent:builder')).toBe(false);
  });

  test('empty turn has no actors; project is context only when supplied', () => {
    expect(extractTurnActors(turn, [], [])).toEqual([]);
    expect(
      extractTurnActors(turn, [], [], { projectId: 'mafw' }),
    ).toContainEqual(
      expect.objectContaining({ actorId: 'project:mafw', role: 'context' }),
    );
  });
});

describe('parseActorQuery', () => {
  test('recognizes role words and explicit ids', () => {
    expect(parseActorQuery('reviewer 说 builder 的 embedding 改动不行').sort()).toEqual(
      ['agent:builder', 'agent:reviewer'].sort(),
    );
    expect(parseActorQuery('用 read 工具看看')).toContain('tool:read');
    expect(parseActorQuery('agent:tech-lead 怎么定的')).toContain('agent:tech-lead');
  });

  test('does not treat generic words as actors', () => {
    expect(parseActorQuery('user input validation')).toEqual([]);
    expect(parseActorQuery('preview the diff')).toEqual([]);
    expect(parseActorQuery('weather tomorrow')).toEqual([]);
  });
});

describe('concept aliases', () => {
  test('maps Chinese aliases to canonical concept ids', () => {
    expect(matchConcepts('解析失败')).toContainEqual({
      conceptId: 'error:json_parse',
      weight: 1,
    });
    expect(expandQueryConcepts('覆盖率')).toContain('metric:coverage');
    expect(expandQueryConcepts('合并 太多')).toContain('action:merge');
    expect(expandQueryConcepts('连接重置')).toContain('error:connection_reset');
  });

  test('ASCII aliases respect word boundaries', () => {
    expect(matchConcepts('unparseable JSON')).toContainEqual(
      expect.objectContaining({ conceptId: 'error:json_parse' }),
    );
    expect(matchConcepts('emerged')).toEqual([]);
  });

  test('extractTurnConcepts dedupes multiple aliases of one concept', () => {
    const concepts = extractTurnConcepts(turn, [
      row('user_input', '解析失败 unparseable JSON'),
    ]);
    expect(concepts.filter((c) => c.conceptId === 'error:json_parse')).toHaveLength(1);
    expect(concepts[0]).toMatchObject({ traceId: 't1t_a' });
  });
});

describe('sparse encoder', () => {
  test('emits concept, actor, entity and token terms', () => {
    const rows = [row('user_input', '解析失败 unparseable JSON')];
    const feature = {
      traceId: 't1t_a',
      sessionId: 's1',
      turnSeq: 1,
      entities: ['reflection.ts'],
      outcome: 'unknown' as const,
      confidence: 0.5,
    };
    const concepts = extractTurnConcepts(turn, rows);
    const actors = extractTurnActors(turn, rows, [{ agent: 'reviewer' }]);
    const terms = encodeTurnSparseTerms({ turn, rows, feature, concepts, actors });

    expect(terms.map((t) => t.termId)).toEqual(
      expect.arrayContaining([
        'concept:error:json_parse',
        'actor:agent:reviewer',
        'entity:reflection.ts',
      ]),
    );
    expect(terms.some((t) => t.kind === 'token')).toBe(true);
    expect(terms.every((t) => t.model === 'sparse-lex-v1')).toBe(true);
  });

  test('query term ids match encoded token ids for exact identifiers', () => {
    const terms = encodeTurnSparseTerms({
      turn,
      rows: [row('tool_result', 'ECONNRESET retry with backoff')],
    });
    const ids = terms.map((t) => t.termId);
    expect(querySparseTermIds('ECONNRESET').some((id) => ids.includes(id))).toBe(true);
    expect(querySparseTermIds('解析失败')).toContain('concept:error:json_parse');
  });

  test('embedding atoms become sparse semantic terms without re-filtering', () => {
    const terms = encodeTurnSparseTerms({
      turn,
      rows: [row('user_input', 'network reset')],
      atoms: [
        { termId: 'error:connection_reset', score: 0.1 },
        { termId: 'noise', score: 0.05 },
      ],
    });
    expect(terms).toContainEqual(
      expect.objectContaining({
        termId: 'sem:error:connection_reset',
        kind: 'semantic',
        weight: 0.1,
        model: 'sparse-embed-v1',
      }),
    );
    // Selection happens upstream; a calibrated low score must not be dropped here.
    expect(terms.some((t) => t.termId === 'sem:noise')).toBe(true);
  });

  test('empty rows produce an empty code', () => {
    expect(encodeTurnSparseTerms({ turn, rows: [] })).toEqual([]);
  });
});

describe('encodeT1Turn', () => {
  test('writes actors/concepts/sparse and a completion marker', () => {
    const writes = {
      actors: [] as unknown[],
      concepts: [] as unknown[],
      sparse: [] as unknown[],
      marker: null as any,
    };
    const result = encodeT1Turn(turn, {
      readTurnRows: () => [row('user_input', '解析失败 reviewer 的改动')],
      readTrajectoryEvents: () => [{ agent: 'reviewer' }],
      upsertTurnActors: (_id, actors) => {
        writes.actors = actors;
      },
      upsertTurnConcepts: (_id, concepts) => {
        writes.concepts = concepts;
      },
      upsertSparseTerms: (_id, terms) => {
        writes.sparse = terms;
      },
      upsertTurnEncoding: (marker) => {
        writes.marker = marker;
      },
    });

    expect(result.traceId).toBe('t1t_a');
    expect(result.actors).toBeGreaterThan(0);
    expect(result.concepts).toBeGreaterThan(0);
    expect(result.sparse).toBeGreaterThan(0);
    expect(writes.actors).toHaveLength(result.actors);
    expect(writes.marker).toMatchObject({
      traceId: 't1t_a',
      model: 'sparse-lex-v1',
      conceptCount: result.concepts,
      sparseCount: result.sparse,
    });
  });
});
