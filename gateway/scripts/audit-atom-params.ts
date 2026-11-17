/**
 * Parameter-provenance audit for the T1 sparse atoms.
 *
 * Run from gateway/:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/audit-atom-params.ts
 *
 * Read-only: samples texts from the live DB, embeds them with the configured
 * provider, and reports (a) how much the per-anchor baseline moves with the
 * reference sample, (b) how much the selected atom set moves with the
 * thresholds. It does not write atoms or config.
 */
import * as os from 'os';
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { buildConceptAnchors } from '../src/recall/t1-semantic-atoms';
import {
  computeAnchorBaselines,
  cosineSimilarity,
  selectCalibratedAtoms,
} from '../src/recall/t1-atom-calibration';

const TURN_SAMPLE = 200;
const REF_SAMPLE = 240;
const CURRENT = { topK: 2, minScore: 0.02, minTop1: 0.05 };

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const id of A) if (B.has(id)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

function stats(values: number[]): { mean: number; sd: number; min: number; max: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean: +mean.toFixed(4), sd: +sd.toFixed(4), min: +Math.min(...values).toFixed(4), max: +Math.max(...values).toFixed(4) };
}

async function main() {
  const db = new GatewayDatabase(path.join(config.resolvePath('memory'), 'gateway.db'));
  const rt = initEmbeddingRuntime({
    baseDir: path.join(os.tmpdir(), 'mafw-atom-audit'),
    cfg: config.memory.embedding,
  });
  if (!rt?.provider) {
    console.error('embedding runtime unavailable');
    process.exit(1);
  }

  const anchors = buildConceptAnchors();
  const allRefs = db.sampleTurnTexts(REF_SAMPLE);
  const allTurns = db.sampleTurnTexts(1200).filter((_, i) => i % 6 === 0).slice(0, TURN_SAMPLE);

  const anchorVectors = await rt.provider.embed(anchors.map((a) => a.text), 'document');
  const refVectors = await rt.provider.embed(allRefs, 'document');
  const turnVectors = await rt.provider.embed(allTurns, 'document');

  const refSlices = [
    { name: 'first-24', vectors: refVectors.slice(0, 24) },
    { name: 'next-24', vectors: refVectors.slice(24, 48) },
    { name: 'third-24', vectors: refVectors.slice(48, 72) },
    { name: 'all-240', vectors: refVectors },
  ];
  const baselines = refSlices.map((slice) => computeAnchorBaselines(anchorVectors, slice.vectors));

  const rawByTurn = turnVectors.map((vec) =>
    anchors.map((anchor, index) => ({ termId: anchor.termId, cosine: cosineSimilarity(vec, anchorVectors[index]) })),
  );

  const perBaseline = refSlices.map((slice, index) => {
    const base = baselines[index];
    const sets = rawByTurn.map((raw) => selectCalibratedAtoms(raw, base, CURRENT).map((a) => a.termId));
    const atoms = sets.reduce((sum, set) => sum + set.length, 0);
    const abstained = sets.filter((set) => set.length === 0).length;
    return {
      baseline: slice.name,
      atomsPerTurn: +(atoms / sets.length).toFixed(2),
      abstained: +(abstained / sets.length).toFixed(2),
      jaccardVsCurrent: +(sets.reduce((sum, set, i) => {
        const current = selectCalibratedAtoms(rawByTurn[i], baselines[0], CURRENT).map((a) => a.termId);
        return sum + jaccard(set, current);
      }, 0) / sets.length).toFixed(3),
    };
  });

  const anchorSpread = anchors.map((anchor, index) => {
    const values = baselines.map((base) => base[index]);
    return { anchor: anchor.termId, ...stats(values) };
  });

  const grids: Array<{ topK: number; minScore: number; minTop1: number; atomsPerTurn: number; abstained: number; jaccardVsCurrent: number }> = [];
  for (const topK of [1, 2, 3]) {
    for (const minScore of [0.01, 0.02, 0.03]) {
      for (const minTop1 of [0.03, 0.05, 0.07]) {
        const sets = rawByTurn.map((raw) => selectCalibratedAtoms(raw, baselines[3], { topK, minScore, minTop1 }).map((a) => a.termId));
        const current = rawByTurn.map((raw) => selectCalibratedAtoms(raw, baselines[0], CURRENT).map((a) => a.termId));
        grids.push({
          topK,
          minScore,
          minTop1,
          atomsPerTurn: +(sets.reduce((sum, set) => sum + set.length, 0) / sets.length).toFixed(2),
          abstained: +(sets.filter((set) => set.length === 0).length / sets.length).toFixed(2),
          jaccardVsCurrent: +(sets.reduce((sum, set, i) => sum + jaccard(set, current[i]), 0) / sets.length).toFixed(3),
        });
      }
    }
  }

  console.log(JSON.stringify({
    anchors: anchors.length,
    referenceTexts: allRefs.length,
    auditTurns: allTurns.length,
    current: CURRENT,
    referenceSample: perBaseline,
    anchorBaselineSpread: anchorSpread,
    grid: grids,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
