import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { createKernelV2Server } from '../../src/kernel-v2/facade';
import { readKernelV2Config } from '../../src/kernel-v2/main';
import type { KernelDiagnostic } from '../../src/kernel-v2/diagnostics';
import type { TtsCapability } from '../../src/kernel-v2/providers/tts';
import type { UsageCapability } from '../../src/kernel-v2/providers/usage';
import type { TtsEngine, TtsProfile } from '../../src/tts/types';
import type { UsageProvider } from '../../src/usage/types';

const profile: TtsProfile = {
  streaming: 'native',
  voiceCloning: false,
  styleControl: false,
  languages: ['zh'],
  sampleRate: 24000,
};

const engine: TtsEngine = {
  name: 'mimo',
  profile,
  voices: () => [{ id: '鑼夎帀', label: '鑼夎帀', lang: 'zh' }],
  async *synthesizeStream() {},
  async synthesize() {
    return Buffer.from('wav');
  },
};

const usage: UsageProvider = {
  name: 'fixture',
  windows: [{ window: 'day', used: 1, limit: 10, unit: 'tokens', pct: 10 }],
  severity: 'low',
};

const tts: TtsCapability = {
  resolve: () => engine,
  list: () => [{ id: 'mimo', profile, tier: 'builtin' }],
};

const usageCapability: UsageCapability = {
  resolve: () => ({ name: 'fixture', fetch: async () => usage }),
  adapters: () => [],
};

function diagnostic(): KernelDiagnostic {
  return {
    providerId: 'mimo',
    capability: 'tts',
    version: '1.0.0',
    plane: 'gateway',
    state: 'active',
    revision: 'test',
    at: new Date(0).toISOString(),
  };
}

function listen(server: ReturnType<typeof createKernelV2Server>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('kernel-v2 isolated facade', () => {
  let server: ReturnType<typeof createKernelV2Server>;
  let base: string;

  beforeAll(async () => {
    server = createKernelV2Server({
      tts,
      usage: usageCapability,
      usageSnapshot: async () => [usage],
      diagnostics: () => [diagnostic()],
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('health reports v2 and providers', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      kernel: 'v2',
      providers: [{ providerId: 'mimo', capability: 'tts', state: 'active' }],
    });
  });

  test('tts voices uses the injected capability', async () => {
    const response = await fetch(`${base}/api/tts/voices`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.engine).toBe('mimo');
    expect(body.sampleRate).toBe(24000);
    expect(body.voices[0].id).toBe('鑼夎帀');
    expect(body.engines).toEqual([{ name: 'mimo', source: 'builtin' }]);
  });

  test('usage uses the record/replay snapshot, not the network', async () => {
    const response = await fetch(`${base}/api/usage`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].name).toBe('fixture');
    expect(body.updatedAt).toBe(0);
  });

  test('unknown paths and non-GET methods are rejected', async () => {
    const notFound = await fetch(`${base}/nope`);
    expect(notFound.status).toBe(404);
    const post = await fetch(`${base}/health`, { method: 'POST' });
    expect(post.status).toBe(405);
  });
});

describe('kernel-v2 config', () => {
  test('requires both env vars and an absolute data dir', () => {
    expect(() => readKernelV2Config({})).toThrow(/MAFW_KERNEL_V2_PORT/);
    expect(() =>
      readKernelV2Config({ MAFW_KERNEL_V2_PORT: '3100' }),
    ).toThrow(/MAFW_KERNEL_V2_DATA_DIR/);
    expect(() =>
      readKernelV2Config({
        MAFW_KERNEL_V2_PORT: '3100',
        MAFW_KERNEL_V2_DATA_DIR: 'relative/path',
      }),
    ).toThrow(/absolute/);
  });

  test('returns a validated config', () => {
    const dataDir = path.resolve('kernel-v2-test-data');
    const config = readKernelV2Config({
      MAFW_KERNEL_V2_PORT: '3100',
      MAFW_KERNEL_V2_DATA_DIR: dataDir,
    });
    expect(config.port).toBe(3100);
    expect(config.dataDir).toBe(dataDir);
  });
});

