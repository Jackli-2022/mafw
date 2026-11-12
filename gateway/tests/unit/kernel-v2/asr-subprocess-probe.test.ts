import { createAsrSidecarProvider } from '../../../src/kernel-v2/probes/asr-subprocess';
import { SubprocessLedger } from '../../../src/kernel-v2/subprocess-ledger';
import type { AsrEngine } from '../../../src/voice/types';

function engine(name = 'qwen3-asr-vllm'): AsrEngine {
  return {
    name,
    capabilities: {
      streaming: 'native',
      languages: ['zh'],
      punctuation: true,
      timestamps: 'none',
      sampleRate: 16000,
    },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({
      push: () => {},
      end: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
      abort: () => {},
      onPartial: () => {},
    }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
  };
}

function sidecar(over: Record<string, unknown> = {}) {
  const calls = { start: 0, stop: 0, stopSync: 0 };
  const value = {
    pid: 4321,
    async start() {
      calls.start += 1;
    },
    async stop() {
      calls.stop += 1;
    },
    stopSync() {
      calls.stopSync += 1;
    },
    async isReady() {
      return true;
    },
    isExternal() {
      return false;
    },
    ...over,
  };
  return { value, calls };
}

describe('S3 ASR sidecar provider', () => {
  test('load does not spawn; activate starts exactly once under concurrency', async () => {
    const { value, calls } = sidecar();
    const provider = createAsrSidecarProvider({
      id: 'qwen3',
      sidecar: value,
      engine: engine(),
      ledger: new SubprocessLedger(),
    });
    await provider.load();
    expect(calls.start).toBe(0);
    await Promise.all([provider.activate(), provider.activate()]);
    expect(calls.start).toBe(1);
  });

  test('start failure is fail-soft, records failed and leaves no active child', async () => {
    const { value } = sidecar({
      start: async () => {
        throw new Error('sidecar_unavailable');
      },
    });
    const ledger = new SubprocessLedger();
    const provider = createAsrSidecarProvider({
      id: 'qwen3',
      sidecar: value,
      engine: engine(),
      ledger,
    });
    await expect(provider.activate()).rejects.toThrow(/sidecar_unavailable/);
    expect(ledger.active()).toEqual([]);
    expect(ledger.snapshot()[0]).toMatchObject({ id: 'qwen3', state: 'failed' });
  });

  test('external adoption is recorded but never stopped', async () => {
    const { value, calls } = sidecar({ isExternal: () => true });
    const ledger = new SubprocessLedger();
    const provider = createAsrSidecarProvider({
      id: 'qwen3',
      sidecar: value,
      engine: engine(),
      ledger,
    });
    await provider.activate();
    expect(ledger.snapshot()[0]).toMatchObject({ ownership: 'external', state: 'running' });
    await provider.deactivate();
    expect(calls.stop).toBe(0);
    expect(calls.stopSync).toBe(0);
  });

  test('startup timeout fails the provider and records the failure', async () => {
    const { value } = sidecar({ start: () => new Promise<void>(() => {}) });
    const ledger = new SubprocessLedger();
    const provider = createAsrSidecarProvider({
      id: 'qwen3',
      sidecar: value,
      engine: engine(),
      ledger,
      startupTimeoutMs: 10,
    });
    await expect(provider.activate()).rejects.toThrow(/timed out/);
    expect(ledger.active()).toEqual([]);
    expect(ledger.snapshot()[0]).toMatchObject({ id: 'qwen3', state: 'failed' });
  });

  test('unhealthy sidecar reports failed health', async () => {
    const { value } = sidecar({ isReady: async () => false });
    const ledger = new SubprocessLedger();
    const provider = createAsrSidecarProvider({
      id: 'qwen3',
      sidecar: value,
      engine: engine(),
      ledger,
    });
    await provider.activate();
    await expect(provider.health()).resolves.toBe('failed');
  });

  test('deactivate and dispose are idempotent and stop an owned child once', async () => {
    const { value, calls } = sidecar();
    const provider = createAsrSidecarProvider({
      id: 'qwen3',
      sidecar: value,
      engine: engine(),
      ledger: new SubprocessLedger(),
    });
    await provider.activate();
    await provider.deactivate();
    await provider.deactivate();
    await provider.dispose();
    expect(calls.stop).toBe(1);
    expect(calls.stopSync).toBe(1);
  });
});
