import { encodeT1Turn } from '../../../src/recall/t1-encode';
import { SPARSE_EMBED_MODEL } from '../../../src/recall/t1-sparse';

function deps(captured: { model?: string }) {
  return {
    readTurnRows: () => [
      { id: 1, session_id: 's1', turn_id: 1, trace_id: 't1t_a', source: 'user_input', content: '修一下 reflection 的边界 recall', failure: 0 },
    ],
    upsertTurnActors: () => {},
    upsertTurnConcepts: () => {},
    upsertSparseTerms: () => {},
    upsertTurnEncoding: (marker: { model: string }) => {
      captured.model = marker.model;
    },
  } as any;
}

const turn = { trace_id: 't1t_a', session_id: 's1', turn_seq: 1 };

describe('T1 encoding provenance', () => {
  test('writes the real embedding provider id into the marker', () => {
    const captured: { model?: string } = {};
    encodeT1Turn(turn, deps(captured), {
      atoms: [{ termId: 'error:json_parse', score: 0.3 }],
      atomsAttempted: true,
      atomModel: 'llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf@1024',
    } as any);
    expect(captured.model).toBe('llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf@1024');
  });

  test('falls back to the logical marker when no provider id is supplied', () => {
    const captured: { model?: string } = {};
    encodeT1Turn(turn, deps(captured), {
      atoms: [{ termId: 'error:json_parse', score: 0.3 }],
      atomsAttempted: true,
    } as any);
    expect(captured.model).toBe(SPARSE_EMBED_MODEL);
  });
});
