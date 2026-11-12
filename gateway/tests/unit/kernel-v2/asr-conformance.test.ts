import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import { createFakeAsrEngine } from '../../fixtures/kernel-v2/asr-fake-provider';
import { runAsrConformance } from '../../helpers/kernel-v2/asr-conformance';
import type { AsrEngine } from '../../../src/voice/types';

function registry(): CapabilityRegistry<AsrEngine> {
  const reg = new CapabilityRegistry<AsrEngine>({
    defaultId: 'qwen3-asr-vllm',
    capability: 'asr',
    version: '1.0.0',
    revision: 'kit',
    plane: 'gateway',
  });
  reg.register('builtin', {
    id: 'qwen3-asr-vllm',
    value: createFakeAsrEngine('qwen3-asr-vllm'),
  });
  return reg;
}

runAsrConformance('asr adapter', {
  create() {
    return { registry: registry(), defaultEngine: 'qwen3-asr-vllm' };
  },
  override: createFakeAsrEngine('qwen3-asr-vllm'),
  throwing: createFakeAsrEngine('throwing', {
    isAvailable: async () => {
      throw new Error('down');
    },
  }),
});
