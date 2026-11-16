/**
 * Real-model T1 atom eval: off vs raw (shipped 0.35/top8) vs calibrated.
 *
 * Deterministic fixtures, non-deterministic embedder (the configured local
 * model). Run with `npm run eval:t1:real`; do not commit its output as a
 * baseline.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { encodeTurnSparseTerms, querySparseTermIds, type T1SparseAtom } from '../../../gateway/src/recall/t1-sparse';
import { extractTurnFeature } from '../../../gateway/src/recall/t1-features';
import { extractTurnActors } from '../../../gateway/src/recall/t1-actors';
import { extractTurnConcepts } from '../../../gateway/src/recall/t1-concepts';
import {
  buildConceptAnchors,
  cosineSimilarity,
  T1SemanticEncoder,
} from '../../../gateway/src/recall/t1-semantic-atoms';
import { BASELINE_QUERIES, FIXTURE_TURNS, seedT1Fixtures } from './fixtures';
import { createRealEmbedder } from './real-embedding';

const K = 3;

function selectRaw(
  raw: Array<{ termId: string; cosine: number }>,
  topK: number,
  minCosine: number,
): T1SparseAtom[] {
  return raw
    .filter((atom) => atom.cosine >= minCosine)
    .sort((a, b) => b.cosine - a.cosine || a.termId.localeCompare(b.termId))
    .slice(0, topK)
    .map((atom) => ({ termId: atom.termId, score: atom.cosine }));
}

function recallAt(ranked: string[], expected: string[]): number {
  if (expected.length === 0) return 1;
  return ranked.slice(0, K).some((id) => expected.includes(id)) ? 1 : 0;
}

function reciprocalRank(ranked: string[], expected: string[]): number {
  if (expected.length === 0) return 1;
  const index = ranked.findIndex((id) => expected.includes(id));
  return index >= 0 ? 1 / (index + 1) : 0;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-real-atoms-'));
  const db = new GatewayDatabase(path.join(dir, 'test.db'));
  const handle = createRealEmbedder(path.join(dir, 'eval-store'));
  try {
    const { traceIds } = seedT1Fixtures(db);
    const keys = Object.keys(traceIds);
    const keyOf = new Map(Object.entries(traceIds).map(([key, traceId]) => [traceId, key]));
    const anchors = buildConceptAnchors();
    const anchorVecs = await handle.embedder.embed(anchors.map((a) => a.text), 'document');

    const turns = FIXTURE_TURNS.map((fixture) => ({
      fixture,
      traceId: traceIds[fixture.key],
      seq: (db.getStore().prepare('SELECT turn_seq FROM t1_turns WHERE trace_id = ?').get(traceIds[fixture.key]) as any).turn_seq,
      text: fixture.rows.map((row) => row.content).join('\n').slice(0, 2000),
    }));
    const turnVecs = await handle.embedder.embed(turns.map((turn) => turn.text), 'document');
    const rawByTrace = new Map(
      turns.map((turn, i) => [
        turn.traceId,
        anchors.map((anchor, k) => ({
          termId: anchor.termId,
          cosine: cosineSimilarity(turnVecs[i], anchorVecs[k]),
        })),
      ]),
    );

    const encoder = new T1SemanticEncoder(handle.embedder, {
      referenceTexts: () => db.sampleTurnTexts(24),
    });
    const calibrated = await encoder.encodeMany(turns.map((turn) => ({ traceId: turn.traceId, text: turn.text })));
    const calibratedQuery = await encoder.encodeMany(
      BASELINE_QUERIES.map((q) => ({ traceId: q.id, text: q.query })),
    );
    const queryVecs = await handle.embedder.embed(BASELINE_QUERIES.map((q) => q.query), 'document');

    const modes = [
      { label: 'off', pick: (_traceId: string) => [] as T1SparseAtom[], query: (_id: string) => [] as T1SparseAtom[] },
      {
        label: 'raw 0.35/top8',
        pick: (traceId: string) => selectRaw(rawByTrace.get(traceId) ?? [], 8, 0.35),
        query: (id: string) => {
          const query = BASELINE_QUERIES.find((q) => q.id === id)!;
          const index = BASELINE_QUERIES.indexOf(query);
          return selectRaw(
            anchors.map((anchor, k) => ({
              termId: anchor.termId,
              cosine: cosineSimilarity(queryVecs[index], anchorVecs[k]),
            })),
            8,
            0.35,
          );
        },
      },
      {
        label: 'calibrated',
        pick: (traceId: string) => calibrated.get(traceId) ?? [],
        query: (id: string) => calibratedQuery.get(id) ?? [],
      },
    ];

    for (const mode of modes) {
      for (const turn of turns) {
        const rows = db.readTurnRows(turn.fixture.session, turn.seq);
        const ref = { trace_id: turn.traceId, session_id: turn.fixture.session, turn_seq: turn.seq };
        const feature = extractTurnFeature(ref, rows);
        const actors = extractTurnActors(ref, rows, [], {});
        const concepts = extractTurnConcepts(ref, rows, feature);
        db.upsertSparseTerms(
          turn.traceId,
          encodeTurnSparseTerms({
            turn: ref,
            rows,
            feature,
            concepts,
            actors,
            atoms: mode.pick(turn.traceId),
          }),
        );
      }

      let recall = 0;
      let mrr = 0;
      let answered = 0;
      const misses: string[] = [];
      for (const query of BASELINE_QUERIES) {
        const atoms = mode.query(query.id);
        const extra = atoms.map((atom) => `sem:${atom.termId}`);
        const ids = [...new Set([...querySparseTermIds(query.query), ...extra])].slice(0, 64);
        let ranked: string[] = [];
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',');
          const rows = db.getStore()
            .prepare(
              `SELECT s.trace_id, SUM(s.weight) AS score FROM t1_sparse_terms s
                WHERE s.term_id IN (${placeholders})
                GROUP BY s.trace_id ORDER BY score DESC LIMIT ?`,
            )
            .all(...ids, K) as Array<{ trace_id: string }>;
          ranked = rows.map((row) => keyOf.get(row.trace_id) ?? '').filter(Boolean);
        }
        recall += recallAt(ranked, query.expected);
        mrr += reciprocalRank(ranked, query.expected);
        if (query.expected.length > 0) answered++;
        if (query.expected.length > 0 && recallAt(ranked, query.expected) === 0) misses.push(query.id);
      }

      const counts = turns.map((turn) => mode.pick(turn.traceId).length);
      const zero = counts.filter((count) => count === 0).length / counts.length;
      const avg = counts.reduce((sum, count) => sum + count, 0) / counts.length;
      let overlap = 0;
      let pairs = 0;
      for (let i = 0; i < turns.length; i++) {
        for (let j = i + 1; j < turns.length; j++) {
          const a = new Set(mode.pick(turns[i].traceId).map((atom) => atom.termId));
          const b = new Set(mode.pick(turns[j].traceId).map((atom) => atom.termId));
          overlap += [...a].filter((term) => b.has(term)).length;
          pairs++;
        }
      }
      console.log(
        `${mode.label.padEnd(16)} recall@${K}=${(recall / BASELINE_QUERIES.length).toFixed(3)} ` +
        `mrr=${(mrr / BASELINE_QUERIES.length).toFixed(3)} ` +
        `atoms=${avg.toFixed(2)} zero=${(zero * 100).toFixed(0)}% ` +
        `overlap=${(overlap / Math.max(1, pairs)).toFixed(2)} misses=${misses.join(',') || '-'}`,
      );
    }

    const holdout = BASELINE_QUERIES.find((query) => query.id === 'q-parse-holdout')!;
    const reflection = FIXTURE_TURNS.find((fixture) => fixture.key === 'reflection')!;
    console.log('\nholdout atoms:');
    console.log(`  turn  ${calibrated.get(traceIds[reflection.key])?.map((a) => `${a.termId}:${a.score.toFixed(3)}`).join(' ') || '(none)'}`);
    console.log(`  query ${calibratedQuery.get(holdout.id)?.map((a) => `${a.termId}:${a.score.toFixed(3)}`).join(' ') || '(none)'}`);
    console.log(`  model ${handle.model}; keys ${keys.length}`);
  } finally {
    await handle.dispose();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
