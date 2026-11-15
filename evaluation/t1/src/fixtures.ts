import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { t1VectorKey } from '../../../gateway/src/recall/verbatim-recall';
import type { FakeVectorRow } from './fake-embedding';

export interface FixtureTurn {
  key: string;
  session: string;
  rows: Array<{ source: 'user_input' | 'tool_result' | 'assistant_reply'; content: string }>;
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
    if (fixture.archive) db.archiveTurn(fixture.session, turn.turn_seq);
  }

  return { traceIds, vectorRows };
}
