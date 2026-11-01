import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONTEXT_SIZE,
  embeddingDraftFromState,
  embeddingDraftDirty,
  embeddingUpdatePayload,
  normalizeBatchSize,
} from './config-embedding';

describe('config embedding draft', () => {
  it('falls back to defaults when the gateway omits llamacpp fields', () => {
    const d = embeddingDraftFromState(null);
    assert.equal(d.provider, 'off');
    assert.equal(d.engine, 'onnx');
    assert.equal(d.gpu, 'cpu');
    assert.equal(d.threads, 2);
    assert.equal(d.contextSize, DEFAULT_CONTEXT_SIZE);
    assert.equal(d.batchSize, DEFAULT_BATCH_SIZE);
  });

  it('reads the persisted batch size', () => {
    const d = embeddingDraftFromState({
      provider: 'local',
      engine: 'llamacpp',
      threads: 2,
      llamacpp: { gpu: 'cuda', contextSize: 2048, batchSize: 512 },
    });
    assert.equal(d.batchSize, 512);
    assert.equal(d.gpu, 'cuda');
  });

  it('marks the draft dirty when only the batch size changes', () => {
    const state = { provider: 'local', engine: 'llamacpp', threads: 2, llamacpp: { gpu: 'cuda', contextSize: 2048, batchSize: 256 } };
    const draft = embeddingDraftFromState(state);
    assert.equal(embeddingDraftDirty(draft, state), false);
    assert.equal(embeddingDraftDirty({ ...draft, batchSize: '128' }, state), true);
  });

  it('builds an update payload with numeric batch size', () => {
    const payload = embeddingUpdatePayload({ provider: 'local', engine: 'llamacpp', gpu: 'cuda', threads: '2', contextSize: '2048', batchSize: '512' });
    assert.deepEqual(payload, {
      provider: 'local',
      engine: 'llamacpp',
      threads: 2,
      llamacpp: { gpu: 'cuda', contextSize: 2048, batchSize: 512 },
    });
  });

  it('clamps the batch size to the gateway validation range', () => {
    assert.equal(normalizeBatchSize(8), 32);
    assert.equal(normalizeBatchSize(99999), 32768);
    assert.equal(normalizeBatchSize('512'), 512);
    assert.equal(normalizeBatchSize('nope'), DEFAULT_BATCH_SIZE);
  });

  it('narrows unknown provider/engine ids to the safe default', () => {
    const payload = embeddingUpdatePayload({
      provider: 'weird',
      engine: 'weird',
      gpu: 'cpu',
      threads: 2,
      contextSize: 2048,
      batchSize: 256,
    });
    assert.equal(payload.provider, 'off');
    assert.equal(payload.engine, 'onnx');
  });
});
