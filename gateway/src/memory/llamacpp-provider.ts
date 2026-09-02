// llama.cpp embedding engine via llama-server sidecar (native binary).
//
// Why a sidecar instead of node-llama-cpp: the JS binding layer costs ~5.5x
// on this class of hardware (native decodeBatch 111 tok/s vs official
// llama-bench 610 tok/s on i9-13900H), and its npm optionalDeps bloat every
// install by ~650MB. The official llama.cpp win-cpu zip is 18MB, runs the
// model at native speed, keeps embeddings out of the gateway process (crash
// isolation + OS-level memory accounting), and switching to GPU later is a
// binary-variant swap (vulkan zip, 34MB) with zero code changes.
//
// Lifecycle: lazy start on first embed → poll /health → OpenAI-compatible
// POST /v1/embeddings. Fail-open: startup/inference errors propagate so
// callers (computeDenseScores, EmbeddingIndexer) degrade to BM25-only.
//
// Query/document asymmetry reuses the Qwen3 recipe via buildQueryInput —
// llama.cpp pooling (LAST) comes from the GGUF metadata, not our code.

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { buildQueryInput, EmbeddingKind, EmbeddingProvider } from './embedding-provider';

export interface LlamaCppConfig {
  /** Server port. 0 = pick a free loopback port (default). */
  port?: number;
  /** llama-server -t (default 2: background service must not hog cores). */
  threads?: number;
  /** -c context size; small on purpose (default 2048 caused 4.2GB RSS in tests). */
  contextSize?: number;
  /** 'cpu' (default) | 'vulkan' — selects the binary variant to download/run. */
  gpu?: string;
  /** GGUF path, or 'hf:<repo>:<filename>' (downloaded from HF_ENDPOINT mirror). */
  modelFile?: string;
  /** llama.cpp release tag for auto-download (default b10752). */
  binaryVersion?: string;
  /** Test seam: injected spawn/fetch. */
  deps?: {
    spawnFn?: typeof spawn;
    fetchFn?: typeof fetch;
    binDir?: string;
    modelDir?: string;
  };
}

const DEFAULT_BINARY_VERSION = 'b10752';
const DEFAULT_MODEL = 'hf:mradermacher/Qwen3-Embedding-0.6B-GGUF:Qwen3-Embedding-0.6B.Q4_K_M.gguf';
const HEALTH_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000;

function platformKey(): string {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function assetName(variant: 'cpu' | 'vulkan', version: string): { file: string; exe: string } | null {
  const p = platformKey();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (p === 'win') {
    const v = variant === 'vulkan' ? 'vulkan-x64' : arch === 'arm64' ? 'cpu-arm64' : 'cpu-x64';
    return { file: `llama-${version}-bin-win-${v}.zip`, exe: 'llama-server.exe' };
  }
  if (p === 'mac') {
    return { file: `llama-${version}-bin-macos-arm64.zip`, exe: 'llama-server' };
  }
  if (p === 'linux') {
    return { file: `llama-${version}-bin-ubuntu-x64.zip`, exe: 'llama-server' };
  }
  return null;
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export class LlamaCppServerProvider implements EmbeddingProvider {
  name: string;
  dims: number;
  private cfg: LlamaCppConfig;
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private baseUrl: string | null = null;
  private queryCache = new Map<string, number[][]>();
  private consecutiveFailures = 0;
  private exitHookRegistered = false;

  constructor(opts: { model?: string; dimensions?: number; llamacpp?: LlamaCppConfig }) {
    this.cfg = opts.llamacpp ?? {};
    const modelTag = (this.cfg.modelFile || DEFAULT_MODEL).split(':').pop() || 'qwen3-embedding';
    this.name = `llamacpp:${modelTag}`;
    this.dims = opts.dimensions || 1024;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  private binDir(): string {
    return this.cfg.deps?.binDir ?? path.join(os.homedir(), '.mafw', 'bin', 'llama.cpp');
  }

  private modelDir(): string {
    return this.cfg.deps?.modelDir ?? path.join(os.homedir(), '.mafw', 'models', 'gguf');
  }

  private variant(): 'cpu' | 'vulkan' {
    return this.cfg.gpu === 'vulkan' ? 'vulkan' : 'cpu';
  }

  private async ensureBinary(): Promise<string> {
    const version = this.cfg.binaryVersion || DEFAULT_BINARY_VERSION;
    const asset = assetName(this.variant(), version);
    if (!asset) throw new Error(`llama.cpp binary: unsupported platform ${process.platform}`);
    const dir = path.join(this.binDir(), version, this.variant());
    const exe = path.join(dir, asset.exe);
    if (fs.existsSync(exe)) return exe;

    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, asset.file);
    const rel = `ggml-org/llama.cpp/releases/download/${version}/${asset.file}`;
    const mirrors = [
      `https://github.com/${rel}`,
      `https://ghfast.top/https://github.com/${rel}`,
      `https://gh-proxy.com/https://github.com/${rel}`,
    ];
    const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
    let lastErr: any = null;
    for (const url of mirrors) {
      try {
        log.info(`[LlamaCpp] downloading binary: ${url}`);
        const resp = await fetchFn(url, { redirect: 'follow' } as any);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        fs.writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));
        // tar.exe (bsdtar) ships with Windows 10+ and handles zip; tar on unix too.
        await new Promise<void>((resolve, reject) => {
          const tar = spawn('tar', ['-xf', zipPath, '-C', dir], { windowsHide: true });
          tar.on('exit', code => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
          tar.on('error', reject);
        });
        fs.rmSync(zipPath, { force: true });
        if (!fs.existsSync(exe)) throw new Error(`binary missing after extract: ${exe}`);
        return exe;
      } catch (err: any) {
        lastErr = err;
        log.warn(`[LlamaCpp] binary download failed via ${url}: ${err?.message || err}`);
      }
    }
    throw lastErr ?? new Error('llama.cpp binary download failed on all mirrors');
  }

  private async ensureModel(): Promise<string> {
    const spec = this.cfg.modelFile || DEFAULT_MODEL;
    if (!spec.startsWith('hf:')) {
      if (!fs.existsSync(spec)) throw new Error(`llama.cpp model not found: ${spec}`);
      return spec;
    }
    const [, repo, file] = spec.split(':');
    const dest = path.join(this.modelDir(), file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100 * 1048576) return dest;
    fs.mkdirSync(this.modelDir(), { recursive: true });
    const base = (process.env.HF_ENDPOINT || 'https://hf-mirror.com').replace(/\/$/, '');
    const url = `${base}/${repo}/resolve/main/${file}`;
    log.info(`[LlamaCpp] downloading model: ${url}`);
    const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
    const resp = await fetchFn(url, { redirect: 'follow' } as any);
    if (!resp.ok) throw new Error(`model download HTTP ${resp.status}`);
    fs.writeFileSync(dest + '.tmp', Buffer.from(await resp.arrayBuffer()));
    fs.renameSync(dest + '.tmp', dest);
    return dest;
  }

  private async ensureServer(): Promise<string> {
    if (this.baseUrl && this.child && !this.child.killed) return this.baseUrl;
    if (this.starting) return this.starting.then(() => this.baseUrl as string);
    this.starting = (async () => {
      const exe = await this.ensureBinary();
      const model = await this.ensureModel();
      const port = this.cfg.port && this.cfg.port > 0 ? this.cfg.port : await pickFreePort();
      const threads = Math.max(1, this.cfg.threads ?? 2);
      const ctxSize = Math.max(256, this.cfg.contextSize ?? 512);
      const spawnFn = this.cfg.deps?.spawnFn ?? spawn;
      this.child = spawnFn(exe, [
        '-m', model,
        '--port', String(port),
        '--host', '127.0.0.1',
        '-c', String(ctxSize),
        '-t', String(threads),
        '--embeddings',
        '--log-disable',
      ], { windowsHide: true, stdio: 'ignore' });
      this.child.on('exit', code => {
        log.warn(`[LlamaCpp] server exited (code ${code}) — next embed restarts it`);
        this.child = null;
        this.baseUrl = null;
        this.starting = null;
      });
      if (!this.exitHookRegistered) {
        this.exitHookRegistered = true;
        process.once('exit', () => this.killServer());
      }
      const url = `http://127.0.0.1:${port}`;
      const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      for (;;) {
        try {
          const resp = await fetchFn(`${url}/health`);
          if (resp.ok) break;
        } catch { /* not up yet */ }
        if (Date.now() > deadline) throw new Error('llama-server health check timed out');
        await new Promise(r => setTimeout(r, 500));
      }
      this.baseUrl = url;
      log.info(`[LlamaCpp] server ready on :${port} (threads=${threads}, ctx=${ctxSize}, variant=${this.variant()})`);
    })().catch(err => {
      this.starting = null;
      this.killServer();
      throw err;
    });
    return this.starting.then(() => this.baseUrl as string);
  }

  killServer(): void {
    const child = this.child;
    this.child = null;
    this.baseUrl = null;
    if (!child || child.killed || child.pid == null) return;
    try {
      if (process.platform === 'win32') {
        // child.kill is unreliable for spawned trees on Windows (kernel trap).
        spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch { /* best effort */ }
  }

  // ── EmbeddingProvider ────────────────────────────────────────────────────

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (kind === 'query' && texts.length === 1) {
      const cached = this.queryCache.get(texts[0]);
      if (cached) return cached;
    }
    const baseUrl = await this.ensureServer();
    const inputs = texts.map(t => (kind === 'query' ? buildQueryInput(t) : t));
    const fetchFn = this.cfg.deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let data: any;
    try {
      const resp = await fetchFn(`${baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputs }),
        signal: controller.signal,
      } as any);
      if (!resp.ok) throw new Error(`llama-server embeddings HTTP ${resp.status}`);
      data = await resp.json();
    } finally {
      clearTimeout(timer);
    }
    const rows: Array<{ index: number; embedding: number[] }> = data?.data || [];
    const byIndex = new Map<number, number[]>();
    for (const r of rows) byIndex.set(r.index, r.embedding);
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const vec = byIndex.get(i);
      if (!vec || vec.length === 0) throw new Error(`llama-server embeddings missing index ${i}`);
      const nrm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
      out.push(nrm === 1 ? vec : vec.map(x => x / nrm));
    }
    this.consecutiveFailures = 0;
    if (kind === 'query' && texts.length === 1) {
      if (this.queryCache.size >= 256) {
        const first = this.queryCache.keys().next().value;
        if (first !== undefined) this.queryCache.delete(first);
      }
      this.queryCache.set(texts[0], out);
    }
    return out;
  }
}
