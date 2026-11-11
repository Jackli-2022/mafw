/**
 * E4-1 config.resources: defaults, deep merge, hot-reload fallback.
 * Spec: docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md §5
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Config, GatewayConfig } from '../../src/config';

const RESOURCE_DEFAULTS: GatewayConfig['resources'] = {
  sampleIntervalMs: 30000,
  disk: { warnFreeBytes: 2147483648, criticalFreeBytes: 536870912 },
  heap: { warnRatio: 0.75, criticalRatio: 0.9 },
  limits: {
    httpConnections: 256,
    sseClients: 64,
    wsClients: 64,
    voiceClients: 16,
    terminalClients: 16,
    pythonKernels: 4,
    projects: 128,
    sessions: 1000,
    sessionRecordsPerProject: 200,
  },
  buffers: {
    sseMaxFrames: 256,
    sseMaxBytes: 1048576,
    wsMaxBufferedBytes: 1048576,
  },
};

function writeConfig(dataDir: string, body: unknown): void {
  fs.writeFileSync(path.join(dataDir, 'config.yaml'), yaml.dump(body), 'utf-8');
}

describe('config.resources', () => {
  let projectDir: string;
  let dataDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e4-res-proj-'));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e4-res-data-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('defaults match spec §5', () => {
    const cfg = new Config(projectDir, dataDir);
    expect(cfg.resources).toEqual(RESOURCE_DEFAULTS);
    expect(cfg.raw.resources).toEqual(RESOURCE_DEFAULTS);
  });

  test('partial user config deep-merges over defaults', () => {
    writeConfig(dataDir, {
      resources: {
        sampleIntervalMs: 5000,
        disk: { warnFreeBytes: 67108864 },
        limits: { sessions: 42 },
      },
    });

    const cfg = new Config(projectDir, dataDir);
    expect(cfg.resources.sampleIntervalMs).toBe(5000);
    expect(cfg.resources.disk.warnFreeBytes).toBe(67108864);
    // siblings keep defaults
    expect(cfg.resources.disk.criticalFreeBytes).toBe(536870912);
    expect(cfg.resources.limits.sessions).toBe(42);
    expect(cfg.resources.limits.projects).toBe(128);
    expect(cfg.resources.buffers.sseMaxBytes).toBe(1048576);
  });

  test('0 (= unlimited) survives config merge untouched', () => {
    writeConfig(dataDir, {
      resources: { limits: { sessions: 0, httpConnections: 0 } },
    });

    const cfg = new Config(projectDir, dataDir);
    expect(cfg.resources.limits.sessions).toBe(0);
    expect(cfg.resources.limits.httpConnections).toBe(0);
    expect(cfg.resources.limits.projects).toBe(128);
  });

  test('reload applies resource changes and reports them as changed', () => {
    const cfg = new Config(projectDir, dataDir);
    writeConfig(dataDir, { resources: { heap: { warnRatio: 0.6 } } });

    const { changed } = cfg.reload();
    expect(changed).toContain('resources');
    expect(cfg.resources.heap.warnRatio).toBe(0.6);
    expect(cfg.resources.heap.criticalRatio).toBe(0.9);
  });

  test('deleted keys fall back to defaults on reload', () => {
    writeConfig(dataDir, {
      resources: {
        disk: { warnFreeBytes: 1024, criticalFreeBytes: 512 },
        limits: { sessions: 7 },
      },
    });
    const cfg = new Config(projectDir, dataDir);
    expect(cfg.resources.disk.warnFreeBytes).toBe(1024);
    expect(cfg.resources.limits.sessions).toBe(7);

    // user deletes the whole resources section
    writeConfig(dataDir, { logging: { logLevel: 'info' } });
    cfg.reload();

    expect(cfg.resources).toEqual(RESOURCE_DEFAULTS);
  });

  test('persistOverrides can update a single resource leaf', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ resources: { disk: { criticalFreeBytes: 1048576 } } } as Partial<GatewayConfig>);

    expect(cfg.resources.disk.criticalFreeBytes).toBe(1048576);
    expect(cfg.resources.disk.warnFreeBytes).toBe(2147483648);

    const reloaded = new Config(projectDir, dataDir);
    expect(reloaded.resources.disk.criticalFreeBytes).toBe(1048576);
    expect(reloaded.resources.disk.warnFreeBytes).toBe(2147483648);
  });
});
