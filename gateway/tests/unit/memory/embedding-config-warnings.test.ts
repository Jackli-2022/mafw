import { embeddingConfigWarnings } from '../../../src/memory/embedding-provider';

const base = { provider: 'local', model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX', engine: 'onnx' } as any;

describe('embedding config warnings', () => {
  test('llamacpp engine + ONNX model id is flagged', () => {
    const warnings = embeddingConfigWarnings({ ...base, engine: 'llamacpp' });
    expect(warnings.join(' ')).toMatch(/llamacpp/i);
    expect(warnings.join(' ')).toMatch(/ONNX/i);
  });

  test('onnx engine + gguf model is flagged', () => {
    const warnings = embeddingConfigWarnings({
      ...base,
      engine: 'onnx',
      model: 'Qwen3-Embedding-0.6B.Q4_K_M.gguf',
    });
    expect(warnings.join(' ')).toMatch(/onnx/i);
    expect(warnings.join(' ')).toMatch(/gguf/i);
  });

  test('a consistent config has no warnings', () => {
    expect(embeddingConfigWarnings(base)).toEqual([]);
  });
});
