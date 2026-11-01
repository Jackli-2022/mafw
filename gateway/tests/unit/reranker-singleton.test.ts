/**
 * Reranker singleton: a config change (gpu or batch size) rebuilds the
 * instance. The replaced sidecar must be killed, otherwise every tweak from
 * the Config page leaves an orphan llama-server holding ~1.1GB VRAM.
 */
const mockKilled: string[] = [];

jest.mock('../../src/config', () => ({
  config: {
    search: {
      reranker: 'llamacpp',
      rerankerGpu: 'vulkan',
      rerankerBatchSize: 512,
    },
  },
}));

jest.mock('../../src/core/memory/reranker', () => ({
  createReranker: (name: string, _weights: any, opts: any) => ({
    name,
    opts,
    killServer: () => mockKilled.push(`${opts.gpu}:${opts.batchSize}`),
  }),
}));

import { config } from '../../src/config';
import { getReranker, resetRerankerSingleton } from '../../src/core/memory/reranker-singleton';

const search = config.search as any;

beforeEach(() => {
  resetRerankerSingleton();
  mockKilled.length = 0;
  search.reranker = 'llamacpp';
  search.rerankerGpu = 'vulkan';
  search.rerankerBatchSize = 512;
});

test('first build passes the configured batch size', () => {
  const r = getReranker() as any;
  expect(r.opts).toEqual({ gpu: 'vulkan', batchSize: 512 });
  expect(mockKilled).toEqual([]);
});

test('batch-size change rebuilds and kills the old sidecar', () => {
  const first = getReranker();
  search.rerankerBatchSize = 256;
  const second = getReranker();
  expect(second).not.toBe(first);
  expect((second as any).opts.batchSize).toBe(256);
  expect(mockKilled).toEqual(['vulkan:512']);
});

test('unchanged config reuses the cached instance (no kill)', () => {
  const first = getReranker();
  const again = getReranker();
  expect(again).toBe(first);
  expect(mockKilled).toEqual([]);
});
