/* Probe v2: memory diagnosis — output keys, per-batch RSS growth. */
import { createEmbeddingProvider } from '../../../gateway/src/memory/embedding-provider';

function rss(): number { return Math.round(process.memoryUsage().rss / 1024 / 1024); }

async function main() {
  console.log('rss start:', rss(), 'MB');
  const provider = createEmbeddingProvider({
    provider: 'local',
    model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    dimensions: 1024,
  })!;

  const [qv] = await provider.embed(['warmup'], 'query');
  console.log('after load+warmup rss:', rss(), 'MB, dims', qv.length);

  // 16 × ~1200-char docs (worst eval batch)
  const docs = Array.from({ length: 16 }, (_, i) => ('x'.repeat(40) + ` session transcript chunk ${i} `.repeat(30)));
  for (let round = 1; round <= 4; round++) {
    const t0 = Date.now();
    await provider.embed(docs, 'document');
    global.gc?.();
    console.log(`round ${round}: embed ms = ${Date.now() - t0}, rss = ${rss()} MB`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('PROBE FAILED:', err?.message || err); process.exit(1); });
