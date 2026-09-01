/* Probe local Qwen3-Embedding-0.6B ONNX: load, embed query+docs, print dims/latency. */
import { createEmbeddingProvider } from '../../../gateway/src/memory/embedding-provider';

async function main() {
  const t0 = Date.now();
  const provider = createEmbeddingProvider({
    provider: 'local',
    model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    dimensions: 1024,
  })!;
  console.log('provider:', provider.name, 'dims:', provider.dims);

  const qv: number[] = await provider.embed(['What did I do last week?'], 'query').then(v => v[0]);
  console.log('query embed ok, dims =', qv.length, 'load+embed ms =', Date.now() - t0);

  const docs = [
    'User prefers terse Chinese responses and direct master workflow.',
    '2026-08-31 session fixed the Config page dropdown Kobalte matching.',
    'kubernetes cluster setup notes from 2023.',
  ];
  const t1 = Date.now();
  const dv: number[][] = await provider.embed(docs, 'document');
  console.log('doc batch ms =', Date.now() - t1, 'dims =', dv.map(v => v.length));

  // cosine sanity: query vs docs
  const cos = (a: number[], b: number[]) => a.reduce((s: number, x: number, i: number) => s + x * b[i], 0);
  const q2: number[] = await provider.embed(['用户偏好简洁的中文回复'], 'query').then(v => v[0]);
  console.log('cos(query en, doc1 en) =', cos(qv, dv[0]).toFixed(4));
  console.log('cos(query zh, doc1 en) =', cos(q2, dv[0]).toFixed(4));
  console.log('cos(query zh, doc2 zh) =', cos(q2, dv[1]).toFixed(4));
  const norm = Math.sqrt(qv.reduce((s: number, x: number) => s + x * x, 0));
  console.log('query vec norm =', norm.toFixed(4));
}

main().then(() => process.exit(0)).catch(err => { console.error('PROBE FAILED:', err?.message || err); process.exit(1); });
