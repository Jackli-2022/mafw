/**
 * T1 retrieval baseline: FTS vs dense vs fused.
 *
 * Deterministic and offline. Seeds a temp GatewayDatabase with fixture turns,
 * builds a concept-embedding stub over the T1 vectors, and reports Recall@k /
 * MRR / no-answer accuracy per channel. This measures the pipeline, not a real
 * embedding model.
 *
 * Run: npm run eval:t1
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { makeT1Search } from '../../../gateway/src/recall/verbatim-recall';
import { fuseT1Hits } from '../../../gateway/src/recall/t1-search';
import { BASELINE_QUERIES, seedT1Fixtures } from './fixtures';
import { createFakeT1Runtime } from './fake-embedding';
import { recallAtK, mrr, summarize } from './metrics';

const K = 3;

interface QueryRow {
  id: string;
  query: string;
  expected: string[];
  fts: string[];
  dense: string[];
  fused: string[];
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-t1-eval-'));
  const db = new GatewayDatabase(path.join(dir, 't1.db'));
  try {
    const { traceIds, vectorRows } = seedT1Fixtures(db);
    const runtime = createFakeT1Runtime(vectorRows);
    const denseSearch = makeT1Search({
      runtime,
      fetchRows: (sessionId, turnId) => db.readTurnRows(sessionId, turnId),
    });

    const rows: QueryRow[] = [];
    for (const query of BASELINE_QUERIES) {
      const expected = query.expected
        .map((key) => traceIds[key])
        .filter((id): id is string => Boolean(id));
      const lexical = db.searchT1Lexical(query.query, K);
      const dense = await denseSearch(query.query, K);
      const fused = fuseT1Hits(dense, lexical, K);
      rows.push({
        id: query.id,
        query: query.query,
        expected,
        fts: lexical.map((hit) => hit.traceId),
        dense: dense.map((hit) => hit.traceId ?? '').filter(Boolean),
        fused: fused.map((hit) => hit.traceId ?? '').filter(Boolean),
      });
    }

    const channel = (key: 'fts' | 'dense' | 'fused') =>
      summarize(rows.map((row) => ({ expected: row.expected, actual: row[key] })), K);
    const misses = (key: 'fts' | 'dense' | 'fused') =>
      rows
        .filter((row) => recallAtK(row.expected, row[key], K) < 1)
        .map((row) => row.id);

    const report = {
      fixtureVersion: 1,
      embedding: 'synthetic-concept-v1',
      note: 'Synthetic deterministic concept embedding: validates channel wiring/fusion, not model quality.',
      k: K,
      fixtures: {
        turns: Object.keys(traceIds).length,
        queries: rows.length,
      },
      channels: {
        fts: channel('fts'),
        dense: channel('dense'),
        fused: channel('fused'),
      },
      misses: {
        fts: misses('fts'),
        dense: misses('dense'),
        fused: misses('fused'),
      },
      perQuery: rows.map((row) => ({
        id: row.id,
        query: row.query,
        expectedKeys: BASELINE_QUERIES.find((query) => query.id === row.id)?.expected ?? [],
        expectedCount: row.expected.length,
        fts: {
          recall: recallAtK(row.expected, row.fts, K),
          mrr: mrr(row.expected, row.fts),
        },
        dense: {
          recall: recallAtK(row.expected, row.dense, K),
          mrr: mrr(row.expected, row.dense),
        },
        fused: {
          recall: recallAtK(row.expected, row.fused, K),
          mrr: mrr(row.expected, row.fused),
        },
      })),
    };

    const out = path.resolve(__dirname, '..', 'baseline.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf-8');
    console.table(
      Object.entries(report.channels).map(([name, value]) => ({
        channel: name,
        cases: value.cases,
        recallAt3: Number(value.recall.toFixed(3)),
        mrr: Number(value.mrr.toFixed(3)),
        noAnswer: Number(value.noAnswer.toFixed(3)),
      })),
    );
    console.log(`baseline written: ${out}`);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
