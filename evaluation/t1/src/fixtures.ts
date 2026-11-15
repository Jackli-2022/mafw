import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { t1VectorKey } from '../../../gateway/src/recall/verbatim-recall';
import { extractTurnFeature } from '../../../gateway/src/recall/t1-features';
import { extractTurnActors, type T1ActorEvent } from '../../../gateway/src/recall/t1-actors';
import { extractTurnConcepts } from '../../../gateway/src/recall/t1-concepts';
import { encodeTurnSparseTerms } from '../../../gateway/src/recall/t1-sparse';
import type { FakeVectorRow } from './fake-embedding';

export interface FixtureTurn {
  key: string;
  session: string;
  rows: Array<{ source: 'user_input' | 'tool_result' | 'assistant_reply'; content: string }>;
  /** Trajectory actor metadata (agent / tool) for the same turn. */
  events?: T1ActorEvent[];
  archive?: boolean;
}

export interface BaselineQuery {
  id: string;
  query: string;
  expected: string[];
}

export const FIXTURE_TURNS: FixtureTurn[] = [
  {
    key: 'reflection',
    session: 's1',
    rows: [
      { source: 'user_input', content: '修一下 reflection，为什么一直 unparseable JSON' },
      { source: 'tool_result', content: 'read reflection.ts\nconst parsed = parseInsights(text)' },
      { source: 'assistant_reply', content: '根因是 system prompt 丢失；决定 adapter 前置 system。' },
    ],
  },
  {
    key: 'coverage',
    session: 's1',
    archive: true,
    rows: [
      { source: 'user_input', content: 'T1 coverage 太低' },
      { source: 'tool_result', content: 'backfill 200/day' },
      { source: 'assistant_reply', content: 'archive 485/day，coverage 持续下降。' },
    ],
  },
  {
    key: 'provenance',
    session: 's2',
    rows: [
      { source: 'user_input', content: 'provenance 缺失' },
      { source: 'tool_result', content: 'source_trace_ids 0' },
      { source: 'assistant_reply', content: '加 trace links。' },
    ],
  },
  {
    key: 'deployment',
    session: 's2',
    rows: [
      { source: 'user_input', content: 'gateway 宕机后重启' },
      { source: 'tool_result', content: 'deploy restart' },
      { source: 'assistant_reply', content: 'health ok。' },
    ],
  },
  {
    key: 'consolidation',
    session: 's2',
    rows: [
      { source: 'user_input', content: 'consolidation 合并太多' },
      { source: 'tool_result', content: 'soft supersede' },
      { source: 'assistant_reply', content: '用 distinct_from 保持区分。' },
    ],
  },
  {
    key: 'network',
    session: 's2',
    rows: [
      { source: 'user_input', content: 'embedding sidecar ECONNRESET' },
      { source: 'tool_result', content: 't1Indexer batch failed: ECONNRESET' },
      { source: 'assistant_reply', content: 'retry with backoff' },
    ],
  },
  {
    key: 'review',
    session: 's3',
    events: [{ agent: 'reviewer' }, { toolName: 'read' }],
    rows: [
      { source: 'user_input', content: 'reviewer 说 embedding 改动不行' },
      { source: 'tool_result', content: 'read embedding-runtime.ts' },
      { source: 'assistant_reply', content: 'reviewer 要求补 baseline 证据。' },
    ],
  },
  {
    key: 'review-fix',
    session: 's3',
    events: [{ agent: 'builder' }, { toolName: 'edit' }],
    rows: [
      { source: 'user_input', content: 'builder 补了 baseline' },
      { source: 'tool_result', content: 'edit embedding-runtime.ts' },
      { source: 'assistant_reply', content: 'builder 加了 concept 通道。' },
    ],
  },
];

export const BASELINE_QUERIES: BaselineQuery[] = [
  { id: 'q-reflection', query: 'reflection unparseable', expected: ['reflection'] },
  { id: 'q-parse-cn', query: '解析失败', expected: ['reflection'] },
  { id: 'q-coverage', query: 'T1 coverage', expected: ['coverage'] },
  { id: 'q-coverage-cn', query: '覆盖率', expected: ['coverage'] },
  { id: 'q-provenance', query: 'provenance 缺失', expected: ['provenance'] },
  { id: 'q-source', query: '来源 trace', expected: ['provenance'] },
  { id: 'q-deploy', query: 'deployment restart', expected: ['deployment'] },
  { id: 'q-merge', query: '合并 太多', expected: ['consolidation'] },
  { id: 'q-code', query: 'ECONNRESET', expected: ['network'] },
  { id: 'q-synonym-net', query: '连接重置', expected: ['network'] },
  { id: 'q-actor-pair', query: 'reviewer builder embedding', expected: ['review-fix'] },
  { id: 'q-actor-cn', query: '评审说构建者的 embedding 改动', expected: ['review-fix'] },
  { id: 'q-parse-holdout', query: '解码失败', expected: ['reflection'] },
  { id: 'q-none', query: 'weather tomorrow', expected: [] },
];

export function seedT1Fixtures(db: GatewayDatabase): {
  traceIds: Record<string, string>;
  vectorRows: FakeVectorRow[];
} {
  const traceIds: Record<string, string> = {};
  const vectorRows: FakeVectorRow[] = [];

  for (const fixture of FIXTURE_TURNS) {
    const turn = db.beginTurn(fixture.session);
    traceIds[fixture.key] = turn.trace_id;
    for (const row of fixture.rows) {
      db.append({
        session_id: fixture.session,
        turn_id: turn.turn_seq,
        trace_id: turn.trace_id,
        source: row.source,
        content: row.content,
        failure: 0,
      });
      vectorRows.push({
        key: t1VectorKey(fixture.session, turn.turn_seq, row.content),
        text: row.content,
      });
    }
    // Seed trajectory events so actor extraction exercises the real join.
    fixture.events?.forEach((event, index) => {
      db.getStore()
        .prepare(
          `INSERT INTO trajectory_events
             (project_id, session_id, turn_id, seq, event_type, tool_name, agent, time_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'eval',
          fixture.session,
          turn.turn_seq,
          index + 1,
          'tool',
          event.toolName ?? null,
          event.agent ?? null,
          Date.now(),
        );
    });

    const rows = db.readTurn(fixture.session, turn.turn_seq);
    const ref = {
      trace_id: turn.trace_id,
      session_id: fixture.session,
      turn_seq: turn.turn_seq,
    };
    const feature = extractTurnFeature(ref, rows);
    if (feature) db.upsertTurnFeature(feature);

    const actors = extractTurnActors(
      ref,
      rows,
      db.readTrajectoryEvents(fixture.session, turn.turn_seq),
    );
    const concepts = extractTurnConcepts(ref, rows, feature);
    const sparse = encodeTurnSparseTerms({ turn: ref, rows, feature, concepts, actors });
    db.upsertTurnActors(turn.trace_id, actors);
    db.upsertTurnConcepts(turn.trace_id, concepts);
    db.upsertSparseTerms(turn.trace_id, sparse);
    db.upsertTurnEncoding({
      traceId: turn.trace_id,
      model: sparse[0]?.model ?? 'sparse-lex-v1',
      actorCount: actors.length,
      conceptCount: concepts.length,
      sparseCount: sparse.length,
    });

    if (fixture.archive) db.archiveTurn(fixture.session, turn.turn_seq);
  }

  return { traceIds, vectorRows };
}
