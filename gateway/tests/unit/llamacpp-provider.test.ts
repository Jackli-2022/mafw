/**
 * LlamaCppServerProvider: sidecar lifecycle + OpenAI-compatible embeddings
 * mapping + query cache. All I/O mocked (no real binary/model).
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createEmbeddingProvider, EmbeddingProvider } from '../../src/memory/embedding-provider';

function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-llamacpp-'));
  // Pre-place the binary so ensureBinary() skips download.
  const binDir = path.join(dir, 'bin');
  const exeDir = path.join(binDir, 'b10752', 'cpu');
  fs.mkdirSync(exeDir, { recursive: true });
  const exe = path.join(exeDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  fs.writeFileSync(exe, 'fake');
  // Plain-path model file (non hf: spec) skips the size check.
  const model = path.join(dir, 'model.gguf');
  fs.writeFileSync(model, 'fake');

  const child = Object.assign(new EventEmitter(), { killed: false, pid: 4242, kill: () => true });
  const spawns: string[][] = [];
  const spawnFn = ((_exe: string, args: string[]) => {
    spawns.push(args);
    return child;
  }) as any;
  const requests: Array<{ url: string; body?: any }> = [];
  const fetchFn = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.endsWith('/health')) return { ok: true, status: 200 } as any;
    if (u.endsWith('/v1/embeddings')) {
      const body = JSON.parse(init.body);
      requests.push({ url: u, body });
      const inputs: string[] = body.input;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: inputs.map((t: string, index: number) => ({
            index,
            // Unnormalized on purpose: provider must L2-normalize.
            embedding: [t.length, 0, 2],
          })),
        }),
      } as any;
    }
    throw new Error('unexpected fetch: ' + u);
  }) as any;
  return { deps: { spawnFn, fetchFn, binDir: binDir, modelDir: path.join(dir, 'models') }, model, requests, child, spawns };
}

describe('LlamaCppServerProvider', () => {
  function makeProvider(d: ReturnType<typeof makeDeps>): EmbeddingProvider {
    const p = createEmbeddingProvider({
      provider: 'local',
      engine: 'llamacpp',
      llamacpp: { modelFile: d.model, deps: d.deps, threads: 2 },
    });
    expect(p).not.toBeNull();
    return p as EmbeddingProvider;
  }

  test('spawns llama-server and maps OpenAI embeddings shape', async () => {
    const d = makeDeps();
    const provider = makeProvider(d);
    expect(provider.name).toContain('llamacpp:');
    const vecs = await provider.embed(['alpha text', 'beta'], 'document');
    expect(vecs).toHaveLength(2);
    // L2-normalized: [len, 0, 2] / sqrt(len^2+4)
    const v0 = vecs[0];
    const n0 = Math.sqrt(10 * 10 + 4);
    expect(v0[0]).toBeCloseTo(10 / n0, 5);
    expect(v0[2]).toBeCloseTo(2 / n0, 5);
    // batch sent in one request
    expect(d.requests).toHaveLength(1);
    expect(d.requests[0].body.input).toEqual(['alpha text', 'beta']);
  });

  test('query kind gets Instruct prefix; document stays verbatim', async () => {
    const d = makeDeps();
    const provider = makeProvider(d);
    await provider.embed(['my query'], 'query');
    expect(d.requests[0].body.input[0]).toMatch(/^Instruct: .+\nQuery: my query$/);
    await provider.embed(['my doc'], 'document');
    expect(d.requests[1].body.input[0]).toBe('my doc');
  });

  test('identical query served from cache (no second request)', async () => {
    const d = makeDeps();
    const provider = makeProvider(d);
    await provider.embed(['repeat'], 'query');
    await provider.embed(['repeat'], 'query');
    expect(d.requests.filter(r => r.url.includes('embeddings'))).toHaveLength(1);
  });

  test('HTTP failure propagates (callers degrade to BM25)', async () => {
    const d = makeDeps();
    const failing = (async (url: any) => {
      if (String(url).endsWith('/health')) return { ok: true } as any;
      return { ok: false, status: 500 } as any;
    }) as any;
    const provider = createEmbeddingProvider({
      provider: 'local',
      engine: 'llamacpp',
      llamacpp: { modelFile: d.model, deps: { ...d.deps, fetchFn: failing }, threads: 2 },
    }) as EmbeddingProvider;
    await expect(provider.embed(['x'], 'document')).rejects.toThrow(/500/);
  });
});

// Physical batch (-b/-ub) is what drives the GPU compute buffer, not -c:
// measured on RTX 4090 Laptop, ctx 2048 + ub 2048 = 2040MB VRAM vs ub 256 =
// 986MB, and long inputs still embed in full (llama.cpp b10752 splits the
// sequence across ubatches in embeddings mode). Keep ctx, shrink the batch.
describe('LlamaCppServerProvider batch sizing', () => {
  function flag(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  }

  function makeProvider(d: ReturnType<typeof makeDeps>, llamacpp: Record<string, unknown>) {
    const p = createEmbeddingProvider({
      provider: 'local',
      engine: 'llamacpp',
      llamacpp: { modelFile: d.model, deps: d.deps, threads: 2, ...llamacpp },
    });
    expect(p).not.toBeNull();
    return p as EmbeddingProvider;
  }

  test('defaults keep full context and batch at 256', async () => {
    const d = makeDeps();
    await makeProvider(d, {}).embed(['x'], 'document');
    const args = d.spawns[0];
    expect(flag(args, '-c')).toBe('2048');
    expect(flag(args, '-b')).toBe('256');
    expect(flag(args, '-ub')).toBe('256');
  });

  test('explicit batchSize changes -b/-ub only', async () => {
    const d = makeDeps();
    await makeProvider(d, { contextSize: 2048, batchSize: 1024 }).embed(['x'], 'document');
    const args = d.spawns[0];
    expect(flag(args, '-c')).toBe('2048');
    expect(flag(args, '-b')).toBe('1024');
    expect(flag(args, '-ub')).toBe('1024');
  });

  test('batchSize is clamped to context size', async () => {
    const d = makeDeps();
    await makeProvider(d, { contextSize: 512, batchSize: 4096 }).embed(['x'], 'document');
    const args = d.spawns[0];
    expect(flag(args, '-c')).toBe('512');
    expect(flag(args, '-b')).toBe('512');
    expect(flag(args, '-ub')).toBe('512');
  });
});
