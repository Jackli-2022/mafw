/**
 * R6 controlled probe: LongMemEval-S at session granularity has corpus ≈ 50
 * sessions and internal recallK = 50, so the candidate pool already contains
 * everything and chronological neighbors are no-ops. Shrink the pool to expose
 * whether retrieval-side neighbor expansion can ever help ranking.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { config } from '../../../gateway/src/config';
import { buildUnitsForQuestion } from './ingest';
import { loadDataset, sampleStratified } from './dataset';

const KS = [1, 3, 5, 10];

function recallAtK(sessions: string[], answers: string[], k: number): number {
  const top = sessions.slice(0, k);
  return answers.some(a => top.includes(a)) ? 1 : 0;
}

async function main() {
  const all = loadDataset();
  const qs = sampleStratified(all, 20, 42);
  const rows: Array<{ pool: number; arm: 'off' | 'on'; r: Record<number, number[]> }> = [];
  for (const pool of [8, 15, 30, 50]) {
    config.search.recallK = pool;
    for (const arm of ['off', 'on'] as const) {
      const r: Record<number, number[]> = { 1: [], 3: [], 5: [], 10: [] };
      for (const q of qs) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `r6ctl-`));
        fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
        try {
          const store = new HarmonicUnitFileStore(dir);
          const { units, sessionOfUnit } = buildUnitsForQuestion(q, { granularity: 'session', energyMode: 'frozen' });
          for (const u of units) await store.write(u, undefined, { skipMerge: true });
          const index = new HarmonicIndexManager(dir);
          const entries = index.searchScored(q.question, 10, { retriever: 'bm25', temporalNeighbors: arm === 'on' });
          const sessions = entries.map(e => sessionOfUnit.get(e.entry.id)!);
          for (const k of KS) r[k].push(recallAtK(sessions, q.answer_session_ids, k));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      rows.push({ pool, arm, r });
    }
  }
  config.search.recallK = 50;
  console.log('\npool  arm   R@1    R@3    R@5    R@10');
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  for (const row of rows) {
    console.log(`${String(row.pool).padEnd(5)} ${row.arm.padEnd(5)} ${KS.map(k => mean(row.r[k]).toFixed(3)).join('  ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
