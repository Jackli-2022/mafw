import * as path from 'path';
import {
  assertEmbeddingDims,
  embeddingProviderMeta,
  resolveEmbeddingNamespace,
} from '../../src/memory/embedding-namespace';

describe('embedding namespace', () => {
  test('defaults metadata from name and dims', () => {
    expect(embeddingProviderMeta({ name: 'llamacpp:Qwen3-Embedding.gguf', dims: 1024 })).toMatchObject({
      modelTag: expect.stringMatching(/^llamacpp_Qwen3-Embedding\.gguf-[0-9a-f]{8}$/),
      dims: 1024,
      maxInputTokens: 8192,
      batchLimit: 16,
      version: 1,
    });
  });

  test('explicit modelTag wins and is sanitized', () => {
    expect(embeddingProviderMeta({ name: 'local', dims: 512, modelTag: 'my model/v2' })).toMatchObject({
      modelTag: 'my_model_v2',
      dims: 512,
    });
  });

  test('lossy sanitization does not collide for distinct provider ids', () => {
    const a = embeddingProviderMeta({ name: 'a/b', dims: 2 }).modelTag;
    const b = embeddingProviderMeta({ name: 'a_b', dims: 2 }).modelTag;
    expect(a).not.toBe(b);
  });

  test('namespace keeps the legacy vector filename and adds a separate t1 file', () => {
    const base = path.join('/tmp', 'mafw');
    expect(resolveEmbeddingNamespace(base, { name: 'fake-embed', dims: 4 })).toEqual({
      modelTag: 'fake-embed',
      dims: 4,
      version: 1,
      vectorFile: path.join(base, 'memory', 'vectors-fake-embed.json'),
      t1JsonFile: path.join(base, 'memory', 'vectors-t1-fake-embed.json'),
    });
  });

  test('dims mismatch throws with a provider label', () => {
    expect(() => assertEmbeddingDims(4, 3, 'fake-embed')).toThrow(/fake-embed.*4.*3/);
    expect(() => assertEmbeddingDims(4, 4, 'fake-embed')).not.toThrow();
  });
});
