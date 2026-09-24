/**
 * R3 wiring: createReranker factory supports 'llamacpp' (Qwen3-Reranker
 * verification layer) and forwards GPU config. Construction is lazy (no
 * sidecar spawn), so this is safe to instantiate in tests.
 */
import { createReranker } from '../../src/core/memory/reranker';

test("createReranker('off') → null", () => {
  expect(createReranker('off')).toBeNull();
});

test("createReranker('heuristic') → heuristic", () => {
  expect(createReranker('heuristic')?.name).toBe('heuristic');
});

test("createReranker('llamacpp') → llamacpp (no spawn)", () => {
  const r = createReranker('llamacpp', undefined, { gpu: 'cpu' });
  expect(r?.name).toBe('llamacpp');
  // killServer is safe when nothing was spawned.
  (r as any).killServer?.();
});
