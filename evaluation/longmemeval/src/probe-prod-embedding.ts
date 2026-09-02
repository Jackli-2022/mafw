/* Probe v3: production-form embedding latency (abstraction+anchors, ~60 chars). */
import { createEmbeddingProvider } from '../../../gateway/src/memory/embedding-provider';

function rss(): number { return Math.round(process.memoryUsage().rss / 1024 / 1024); }

async function main() {
  const provider = createEmbeddingProvider({
    provider: 'local',
    model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    dimensions: 1024,
  })!;

  // Warmup (model load + first forward)
  const t0 = Date.now();
  await provider.embed(['warmup'], 'query');
  console.log('model load + first embed:', Date.now() - t0, 'ms, rss', rss(), 'MB');

  // Query embed (boundary-recall shape): run 5, report each
  for (let i = 0; i < 5; i++) {
    const tq = Date.now();
    await provider.embed(['边界recall 打分修复 具体怎么改的'], 'query');
    console.log(`query embed #${i + 1}:`, Date.now() - tq, 'ms');
  }

  // Document batch in production form: 16 x ~60 chars (abstraction + anchors)
  const docs = Array.from({ length: 16 }, (_, i) =>
    `index-scan 直连 HTTP cache_control ${i} | prompt flow | cross-encoder | Pairing URL`);
  for (let round = 1; round <= 3; round++) {
    const td = Date.now();
    const vecs = await provider.embed(docs, 'document');
    console.log(`doc batch 16×~60chars #${round}:`, Date.now() - td, 'ms, dims', vecs[0].length);
  }

  // Backfill estimate: 692 entries in batches of 16
  const tb = Date.now();
  for (let b = 0; b < 2; b++) await provider.embed(docs, 'document');
  const perBatch = (Date.now() - tb) / 2;
  console.log(`backfill 692 entries estimate: ${Math.round(perBatch / 16 * 692 / 1000)}s, rss`, rss(), 'MB');
}

main().then(() => process.exit(0)).catch(err => { console.error('PROBE FAILED:', err?.message || err); process.exit(1); });
