import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigLoader } from '../../gateway/src/core/utils/config-loader';

let tmpDir: string;

beforeEach(() => {
  ConfigLoader.reset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-config-'));
});

afterEach(() => {
  ConfigLoader.reset();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ConfigLoader', () => {
  test('default config shape', () => {
    const loader = ConfigLoader.getInstance(tmpDir);
    const config = loader.getAll();

    expect(config.version).toBe('5.0');
    expect(config.storage.backend).toBe('file');
    expect(config.retrieval.enabled).toBe(true);
    expect(config.retrieval.mode).toBe('hybrid');
    expect(config.retrieval.bm25).toEqual({ k1: 1.2, b: 0.75, topK: 20 });
    expect(config.retrieval.vector).toEqual({ model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, topK: 20 });
    expect(config.retrieval.tokenBudget).toBe(2000);
    expect(config.memory.energy.decayRatePerDay).toBe(0.01);
    expect(config.memory.energy.cleanupThreshold).toBe(0.3);
    expect(config.memory.energy.criticalThreshold).toBe(0.8);
    expect(config.hooks.failBehavior).toBe('continue');
    expect(config.hooks.timeout).toBe(5000);
    expect(config.concurrency.maxParallelWaves).toBe(3);
    expect(config.concurrency.lockTimeout).toBe(300000);
    expect(config.dashboard.enabled).toBe(true);
    expect(config.dashboard.port).toBe(3111);
    expect(config.dashboard.refreshInterval).toBe(5000);
    expect(config.logging.level).toBe('info');
    expect(config.logging.maxFiles).toBe(5);
    expect(config.logging.maxSize).toBe('10m');
  });

  test('project config override', () => {
    const mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'config.json'),
      JSON.stringify({
        storage: { backend: 'sqlite', sqlite: { path: '/tmp/test.db', cacheSize: 100, cacheTTL: 60 } },
        retrieval: { mode: 'bm25', tokenBudget: 5000 },
        dashboard: { port: 4000 },
      })
    );

    const loader = ConfigLoader.getInstance(tmpDir);
    const config = loader.getAll();

    expect(config.storage.backend).toBe('sqlite');
    expect(config.storage.sqlite).toEqual({ path: '/tmp/test.db', cacheSize: 100, cacheTTL: 60 });
    expect(config.retrieval.mode).toBe('bm25');
    expect(config.retrieval.tokenBudget).toBe(5000);
    expect(config.dashboard.port).toBe(4000);

    expect(config.retrieval.enabled).toBe(true);
    expect(config.memory.energy.decayRatePerDay).toBe(0.01);
  });

  test('env var override', () => {
    process.env.MAFW_RETRIEVAL_MODE = 'vector';
    process.env.MAFW_TOKEN_BUDGET = '8000';
    process.env.MAFW_STORAGE_BACKEND = 'sqlite';
    process.env.MAFW_DASHBOARD_PORT = '5555';
    process.env.MAFW_LOG_LEVEL = 'debug';

    try {
      ConfigLoader.reset();
      const loader = ConfigLoader.getInstance(tmpDir);
      const config = loader.getAll();

      expect(config.retrieval.mode).toBe('vector');
      expect(config.retrieval.tokenBudget).toBe(8000);
      expect(config.storage.backend).toBe('sqlite');
      expect(config.dashboard.port).toBe(5555);
      expect(config.logging.level).toBe('debug');
    } finally {
      delete process.env.MAFW_RETRIEVAL_MODE;
      delete process.env.MAFW_TOKEN_BUDGET;
      delete process.env.MAFW_STORAGE_BACKEND;
      delete process.env.MAFW_DASHBOARD_PORT;
      delete process.env.MAFW_LOG_LEVEL;
    }
  });

  test('dot notation get', () => {
    const loader = ConfigLoader.getInstance(tmpDir);

    expect(loader.get('version')).toBe('5.0');
    expect(loader.get('retrieval.mode')).toBe('hybrid');
    expect(loader.get('retrieval.bm25.k1')).toBe(1.2);
    expect(loader.get('dashboard.port')).toBe(3111);
    expect(loader.get('logging.level')).toBe('info');
    expect(loader.get('nonexistent.key')).toBeUndefined();
  });

  test('deepMerge utility', () => {
    const target = { a: 1, b: { c: 2, d: 3 }, e: [1, 2] };
    const source = { b: { c: 99 }, f: 4, e: [3, 4] };

    const merged = ConfigLoader.deepMerge(target, source);

    expect(merged.a).toBe(1);
    expect(merged.b.c).toBe(99);
    expect(merged.b.d).toBe(3);
    expect(merged.e).toEqual([3, 4]);
    expect(merged.f).toBe(4);
  });

  test('singleton pattern', () => {
    const loader1 = ConfigLoader.getInstance(tmpDir);
    const loader2 = ConfigLoader.getInstance();

    expect(loader1).toBe(loader2);
  });

  test('get returns entire config when no key', () => {
    const loader = ConfigLoader.getInstance(tmpDir);
    const all = loader.get();
    expect(all).toEqual(loader.getAll());
    expect(all.version).toBe('5.0');
  });
});
