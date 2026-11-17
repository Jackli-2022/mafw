/**
 * Export a frozen engram-P1 dataset: 500 sessions x 6 consecutive turns,
 * split 70/15/15 by session, vectors as little-endian float32.
 *
 * Run from gateway/:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/export-engram-dataset.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../src/config';
import { GatewayDatabase } from '../src/memory/gateway-db';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { normalizeObservationText } from '../src/recall/t1-signals';

const SESSIONS = 1000;
const MIN_TURNS = 4;
const OUT_DIR = path.join(__dirname, 'fixtures', 'engram-p1');

interface Item {
  traceId: string;
  sessionId: string;
  episodeId?: string;
  split: 'train' | 'val' | 'test';
  offset: number;
  turnSeq: number;
}

function splitFor(index: number, total: number): 'train' | 'val' | 'test' {
  if (index < Math.floor(total * 0.7)) return 'train';
  if (index < Math.floor(total * 0.85)) return 'val';
  return 'test';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = new GatewayDatabase(path.join(config.resolvePath('memory'), 'gateway.db'));
  const rt = initEmbeddingRuntime({
    baseDir: path.join(os.tmpdir(), 'mafw-engram-export'),
    cfg: config.memory.embedding,
  });
  if (!rt?.provider) {
    console.error('embedding runtime unavailable');
    process.exit(1);
  }

  const sessions = (db.getStore()
    .prepare(
      `SELECT session_id, COUNT(*) n FROM t1_turns
        GROUP BY session_id HAVING n >= ? ORDER BY session_id LIMIT ?`,
    )
    .all(MIN_TURNS, SESSIONS) as Array<{ session_id: string }>).map((r) => r.session_id);

  const items: Array<Omit<Item, 'offset'>> = [];
  const texts: string[] = [];
  for (const sessionId of sessions) {
    const rows = db.getStore()
      .prepare('SELECT trace_id, turn_seq FROM t1_turns WHERE session_id = ? ORDER BY turn_seq')
      .all(sessionId) as Array<{ trace_id: string; turn_seq: number }>;
    for (const row of rows) {
      const trace = db.readTrace(row.trace_id);
      const text = normalizeObservationText(trace?.rows ?? []);
      if (!text.trim()) continue;
      const member = db.getStore()
        .prepare('SELECT episode_id FROM t1_episode_members WHERE trace_id = ?')
        .get(row.trace_id) as { episode_id?: string } | undefined;
      items.push({
        traceId: row.trace_id,
        sessionId,
        episodeId: member?.episode_id,
        split: splitFor(sessions.indexOf(sessionId), sessions.length),
        turnSeq: row.turn_seq,
      });
      texts.push(text);
    }
  }

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    const embedded = await rt.provider.embed(batch, 'document');
    vectors.push(...embedded);
    if (i % 320 === 0) process.stderr.write(`[engram] embedded ${i}/${texts.length}\n`);
  }

  const dims = vectors[0]?.length ?? rt.provider.dims;
  const buffer = Buffer.alloc(vectors.length * dims * 4);
  vectors.forEach((vector, i) => {
    if (vector.length !== dims) throw new Error(`vector ${i} has ${vector.length} dims, expected ${dims}`);
    Buffer.from(new Float32Array(vector).buffer).copy(buffer, i * dims * 4);
  });
  fs.writeFileSync(path.join(OUT_DIR, 'vectors.f32'), buffer);

  const finalItems: Item[] = items.map((item, i) => ({ ...item, offset: i * dims }));
  const model = `${rt.provider.name ?? rt.providerId}@${dims}`;
  const meta = {
    version: 1,
    model,
    dims,
    k: 16,
    sessions: sessions.length,
    turns: finalItems.length,
    splits: {
      train: finalItems.filter((i) => i.split === 'train').length,
      val: finalItems.filter((i) => i.split === 'val').length,
      test: finalItems.filter((i) => i.split === 'test').length,
    },
    vectorsHash: crypto.createHash('sha256').update(buffer).digest('hex'),
    items: finalItems,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify({ out: OUT_DIR, ...meta, items: undefined }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
