// One-time backfill: embed every archived t1 round into the t1 vector store
// (V1 verbatim dense layer). Usage:
//   mafw stop
//   cd gateway && npx ts-node scripts/backfill-t1-embeddings.ts            # dry-run
//   cd gateway && npx ts-node scripts/backfill-t1-embeddings.ts --apply    # embed
// Resume-safe: rows whose vector key already exists are skipped.
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { t1VectorKey } from '../src/recall/verbatim-recall';

const apply = process.argv.includes('--apply');
// The t1 dense layer is a BOUNDED fast buffer (hippocampal analog: recent
// detail, decaying/evicted), not full-history storage. A single JSON vector
// file hits V8's max string length around ~50k rows (~1GB), so the backfill
// caps at the most recent --limit rows (default 12000 ≈ 250MB).
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 12000) : 12000;
const mafwDir = path.join(os.homedir(), '.mafw');
const db = new Database(path.join(mafwDir, 'memory', 'gateway.db'), { readonly: true });

const rt = initEmbeddingRuntime({ baseDir: mafwDir });
if (!rt || !rt.t1Indexer) {
  console.log('embedding provider is off — enable memory.embedding (local or dashscope) first.');
  process.exit(1);
}

interface Row { session_id: string; turn_id: number; source: string; content: string }

const rows = db
  .prepare('SELECT session_id, turn_id, source, content FROM t1_archive WHERE length(trim(content)) > 0 ORDER BY created_at DESC LIMIT ?')
  .all(limit) as Row[];
console.log(`[backfill] window: most recent ${rows.length} rows (limit ${limit})`);

let missing = 0;
let skipped = 0;
let enqueued = 0;
let pending = 0;
const CHUNK = 500;
const t0 = Date.now();

async function main(): Promise<void> {
  for (const r of rows) {
    const key = t1VectorKey(r.session_id, r.turn_id, r.content);
    if (rt!.t1Vectors.get(key)) {
      skipped++;
      continue;
    }
    missing++;
    if (!apply) continue;
    rt!.t1Indexer.enqueueText(key, r.content.slice(0, 2000));
    enqueued++;
    pending++;
    if (pending >= CHUNK) {
      await rt!.t1Indexer.flushQueue();
      pending = 0;
      console.log(`[backfill] embedded ${enqueued}/${rows.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  }

  if (apply && enqueued > 0) {
    const { indexed, failed } = await rt!.t1Indexer.flushQueue();
    console.log(`[backfill] done: total=${rows.length} enqueued=${enqueued} finalFlushIndexed=${indexed} skipped(existing)=${skipped} failed=${failed} in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(failed > 0 ? 2 : 0);
  } else {
    console.log(`[backfill] dry-run: total rows=${rows.length} missing vectors=${missing} already embedded=${skipped}`);
    console.log(apply ? 'nothing to embed' : 're-run with --apply to embed');
  }
}

main().catch((e: any) => { console.error('[backfill] failed:', e?.message || e); process.exit(3); });

