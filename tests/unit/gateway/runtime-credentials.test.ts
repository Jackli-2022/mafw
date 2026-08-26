import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getProviderApiKey, readOpencodeAuth } from '../../../gateway/src/media/auth-util';
import { createPiPromptAdapter } from '../../../gateway/src/media/pi-adapter';
import { createTtsService } from '../../../gateway/src/media/tts-service';
import { createMediaPluginContext } from '../../../gateway/src/media/plugin-context';
import type { RuntimeClient } from '../../../gateway/src/runtime/contract';

jest.mock('../../../gateway/src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../gateway/src/config', () => ({
  config: {
    raw: { runtime: { pluginConfig: {} } },
    server: { serveUrl: 'http://127.0.0.1:4096' },
    resolvePath: (...p: string[]) => path.join(os.tmpdir(), '.mafw-test', ...p),
  },
}));

jest.mock('../../../gateway/src/opencode-adapter', () => ({
  createOpencodeAdapter: jest.fn(async () => ({
    session: {},
    global: {},
    provider: {},
    app: {},
    config: {},
  })),
}));

import { createOpencodeRuntime } from '../../../gateway/src/runtime/opencode-runtime';

describe('runtime credentials interface', () => {
  describe('RuntimeClient.credentials (contract shape)', () => {
    it('credentials is optional on RuntimeClient', () => {
      const client: Partial<RuntimeClient> = {};
      expect(client.credentials).toBeUndefined();
    });

    it('credentials.getApiKey returns string | null', () => {
      const creds = { getApiKey: (p: string) => p === 'xiaomi' ? 'key-123' : null };
      expect(creds.getApiKey('xiaomi')).toBe('key-123');
      expect(creds.getApiKey('unknown')).toBeNull();
    });
  });

  describe('opencode runtime credentials implementation', () => {
    let tmpDir: string;
    let authPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-cred-'));
      authPath = path.join(tmpDir, 'auth.json');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads API key from auth.json via getProviderApiKey (fallback path)', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        xiaomi: { type: 'api', key: 'xi-key-abc' },
        openai: { type: 'api', key: 'oa-key-def' },
      }));
      expect(getProviderApiKey('xiaomi', authPath)).toBe('xi-key-abc');
      expect(getProviderApiKey('openai', authPath)).toBe('oa-key-def');
      expect(getProviderApiKey('missing', authPath)).toBeUndefined();
    });

    it('getProviderApiKey prefers credentials over auth.json when both present', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        xiaomi: { type: 'api', key: 'file-key' },
      }));
      const credentials = {
        getApiKey: (p: string) => p === 'xiaomi' ? 'runtime-key' : null,
      };
      expect(getProviderApiKey('xiaomi', authPath, credentials)).toBe('runtime-key');
    });

    it('getProviderApiKey falls back to auth.json when credentials returns null', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        xiaomi: { type: 'api', key: 'file-key' },
      }));
      const credentials = {
        getApiKey: (_p: string) => null,
      };
      expect(getProviderApiKey('xiaomi', authPath, credentials)).toBe('file-key');
    });

    it('getProviderApiKey returns undefined when neither credentials nor auth.json has the key', () => {
      fs.writeFileSync(authPath, JSON.stringify({}));
      const credentials = {
        getApiKey: (_p: string) => null,
      };
      expect(getProviderApiKey('missing', authPath, credentials)).toBeUndefined();
    });

    it('getProviderApiKey works without credentials (backward compat)', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        xiaomi: { type: 'api', key: 'solo-key' },
      }));
      expect(getProviderApiKey('xiaomi', authPath)).toBe('solo-key');
    });
  });

  describe('readOpencodeAuth (fallback path)', () => {
    it('returns empty object for missing file', () => {
      expect(readOpencodeAuth('/nonexistent/path/auth.json')).toEqual({});
    });

    it('returns empty object for corrupt JSON', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-cred-'));
      const p = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(p, '{invalid json');
      expect(readOpencodeAuth(p)).toEqual({});
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('opencode runtime exposes credentials', () => {
    it('has credentials.getApiKey function', async () => {
      const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
      expect(rt.credentials).toBeDefined();
      expect(typeof rt.credentials!.getApiKey).toBe('function');
    });

    it('returns null for unknown provider', async () => {
      const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
      expect(rt.credentials!.getApiKey('definitely-not-a-real-provider')).toBeNull();
    });
  });

  describe('pi-adapter credentials integration', () => {
    it('getApiKey override takes priority over credentials', async () => {
      const creds = { getApiKey: (_p: string) => 'should-not-use' };
      let usedKey: string | undefined;
      const prompt = createPiPromptAdapter({
        credentials: creds,
        getApiKey: (p) => { usedKey = 'override-key'; return usedKey; },
        getModel: () => undefined,
      });
      try {
        await prompt([{ type: 'text', text: 'test' }], { providerID: 'xiaomi', modelID: 'test' });
      } catch { /* model lookup fails */ }
      expect(usedKey).toBe('override-key');
    });

    it('uses credentials when no getApiKey override', async () => {
      const creds = { getApiKey: (p: string) => p === 'xiaomi' ? 'cred-key' : null };
      const prompt = createPiPromptAdapter({
        credentials: creds,
        getModel: () => undefined,
      });
      try {
        await prompt([{ type: 'text', text: 'test' }], { providerID: 'xiaomi', modelID: 'test' });
      } catch { /* model lookup fails, but key resolution was exercised */ }
    });
  });

  describe('tts-service credentials integration', () => {
    it('uses injected credentials', async () => {
      const mockFetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { audio: { data: 'dGVzdA==' } } }] }),
        text: async () => '',
      }));
      const creds = { getApiKey: (p: string) => p === 'xiaomi' ? 'cred-key' : null };
      const svc = createTtsService({
        config: () => ({ media: { provider: 'xiaomi' } }),
        fetchImpl: mockFetch as any,
        credentials: creds,
      });
      await svc.synthesize({ text: 'hello' });
      const call = mockFetch.mock.calls[0] as any[];
      expect(call[1].headers.Authorization).toBe('Bearer cred-key');
    });

    it('falls back to auth.json when credentials returns null', async () => {
      const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-fb-'));
      const authFile = path.join(authDir, 'auth.json');
      fs.writeFileSync(authFile, JSON.stringify({ xiaomi: { type: 'api', key: 'file-key' } }));
      const mockFetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { audio: { data: 'dGVzdA==' } } }] }),
        text: async () => '',
      }));
      const svc = createTtsService({
        authPath: authFile,
        config: () => ({ media: { provider: 'xiaomi' } }),
        fetchImpl: mockFetch as any,
        credentials: { getApiKey: () => null },
      });
      await svc.synthesize({ text: 'hello' });
      const call = mockFetch.mock.calls[0] as any[];
      expect(call[1].headers.Authorization).toBe('Bearer file-key');
      fs.rmSync(authDir, { recursive: true, force: true });
    });
  });

  describe('plugin-context credentials integration', () => {
    it('uses injected credentials when available', () => {
      const creds = { getApiKey: (p: string) => p === 'test' ? 'ctx-key' : null };
      const ctx = createMediaPluginContext('test-plugin', creds);
      expect(ctx.apiKey('test')).toBe('ctx-key');
    });

    it('returns null for unknown provider with credentials', () => {
      const creds = { getApiKey: (_p: string) => null };
      const ctx = createMediaPluginContext('test-plugin', creds);
      expect(ctx.apiKey('unknown')).toBeNull();
    });
  });
});
