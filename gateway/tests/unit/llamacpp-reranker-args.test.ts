/**
 * LlamaCppReranker spawn args: context stays at the default 4096 (the rerank
 * prompt embeds query + a 1200-char document), but the physical batch is
 * capped separately — -b/-ub = ctx was spending ~3.4GB VRAM on the compute
 * buffer (measured RTX 4090 Laptop: ub 4096 = 3452MB, ub 512 = 1139MB).
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LlamaCppReranker } from '../../src/core/memory/llamacpp-reranker';

function makeDeps(variant = 'vulkan') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rerank-'));
  const binDir = path.join(dir, 'bin');
  const exeDir = path.join(binDir, 'b10752', variant);
  fs.mkdirSync(exeDir, { recursive: true });
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  fs.writeFileSync(path.join(exeDir, exeName), 'fake');
  const modelDir = path.join(dir, 'models');
  fs.mkdirSync(modelDir, { recursive: true });
  const model = path.join(modelDir, 'rerank.gguf');
  fs.writeFileSync(model, 'fake');

  const child = Object.assign(new EventEmitter(), { killed: false, pid: 4242, kill: () => true });
  const spawns: string[][] = [];
  const spawnFn = ((_exe: string, args: string[]) => {
    spawns.push(args);
    return child;
  }) as any;
  const fetchFn = (async (url: any) => {
    if (String(url).endsWith('/health')) return { ok: true, status: 200 } as any;
    throw new Error('unexpected fetch: ' + String(url));
  }) as any;

  return { deps: { spawnFn, fetchFn, binDir, modelDir }, model, spawns };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('LlamaCppReranker spawn args', () => {
  test('defaults: ctx 4096 with batch 512 and full GPU offload', async () => {
    const d = makeDeps('vulkan');
    const r = new LlamaCppReranker({ modelFile: d.model, gpu: 'vulkan', deps: d.deps });
    await r.ensureServer();
    const args = d.spawns[0];
    expect(flag(args, '-c')).toBe('4096');
    expect(flag(args, '-b')).toBe('512');
    expect(flag(args, '-ub')).toBe('512');
    expect(flag(args, '-ngl')).toBe('99');
  });

  test('explicit batchSize changes -b/-ub only', async () => {
    const d = makeDeps('cuda');
    const r = new LlamaCppReranker({ modelFile: d.model, gpu: 'cuda', batchSize: 256, deps: d.deps });
    await r.ensureServer();
    const args = d.spawns[0];
    expect(flag(args, '-c')).toBe('4096');
    expect(flag(args, '-b')).toBe('256');
    expect(flag(args, '-ub')).toBe('256');
  });

  test('batchSize is clamped to context size', async () => {
    const d = makeDeps('cpu');
    const r = new LlamaCppReranker({
      modelFile: d.model,
      gpu: 'cpu',
      contextSize: 1024,
      batchSize: 8192,
      deps: d.deps,
    });
    await r.ensureServer();
    const args = d.spawns[0];
    expect(flag(args, '-c')).toBe('1024');
    expect(flag(args, '-b')).toBe('1024');
    expect(flag(args, '-ub')).toBe('1024');
    expect(args).not.toContain('-ngl');
  });
});
