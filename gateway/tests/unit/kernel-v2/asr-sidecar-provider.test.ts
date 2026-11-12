import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import { createAsrCapability } from '../../../src/kernel-v2/providers/asr';
import { bindAsrSidecar } from '../../../src/kernel-v2/providers/asr-sidecar';
import { createAsrSidecarProvider } from '../../../src/kernel-v2/probes/asr-subprocess';
import { SubprocessLedger } from '../../../src/kernel-v2/subprocess-ledger';
import { createFakeAsrEngine } from '../../fixtures/kernel-v2/asr-fake-provider';
import type { AsrEngine } from '../../../src/voice/types';

function sidecar(over: Record<string, unknown> = {}) {
  const calls = { start: 0, stop: 0, stopSync: 0 };
  const value = {
    pid: 1234,
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

function registry() {
  return new CapabilityRegistry<AsrEngine>({
    defaultId: 'qwen3-asr-vllm',
    capability: 'asr',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('ASR sidecar binding', () => {
  test('unhealthy builtin sidecar falls back to a package engine', async () => {
    const reg = registry();
    const ledger = new SubprocessLedger();
    let ready = false;
    const { value } = sidecar({ isReady: async () => ready });
    const provider = createAsrSidecarProvider({
      id: 'qwen3-asr-vllm',
      sidecar: value,
      engine: createFakeAsrEngine('qwen3-asr-vllm'),
      ledger,
    });
    const bound = bindAsrSidecar({ registry: reg, provider });

    await provider.activate();
    reg.register('package', {
      id: 'qwen3-asr-vllm',
      value: createFakeAsrEngine('fallback-asr'),
    });
    reg.invalidate();

    expect(createAsrCapability(reg).resolve('qwen3-asr-vllm').name).toBe('fallback-asr');
    await bound.dispose();
  });

  test('dispose removes the provider and stops the child', async () => {
    const reg = registry();
    const ledger = new SubprocessLedger();
    const { value, calls } = sidecar();
    const provider = createAsrSidecarProvider({
      id: 'qwen3-asr-vllm',
      sidecar: value,
      engine: createFakeAsrEngine('qwen3-asr-vllm'),
      ledger,
    });
    const bound = bindAsrSidecar({ registry: reg, provider });
    await provider.activate();
    expect(reg.list().some((item) => item.tier === 'builtin')).toBe(true);

    await bound.dispose();
    expect(reg.list().some((item) => item.tier === 'builtin')).toBe(false);
    expect(ledger.active()).toEqual([]);
    expect(calls.stop).toBe(1);

    await bound.dispose();
    expect(calls.stop).toBe(1);
  });

  test('health callback reads the cached provider health', async () => {
    const reg = registry();
    const ledger = new SubprocessLedger();
    let ready = true;
    const { value } = sidecar({ isReady: async () => ready });
    const provider = createAsrSidecarProvider({
      id: 'qwen3-asr-vllm',
      sidecar: value,
      engine: createFakeAsrEngine('qwen3-asr-vllm'),
      ledger,
    });
    const bound = bindAsrSidecar({ registry: reg, provider });

    await provider.activate();
    expect(bound.health()).toBe('healthy');

    ready = false;
    await provider.health();
    expect(bound.health()).toBe('failed');
    await bound.dispose();
  });
});
