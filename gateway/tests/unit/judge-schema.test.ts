import { schemaFastPath } from '../../src/judge/schema';

describe('schemaFastPath', () => {
  test('semantic 高相似 → 快路径高 energy', () => {
    const r = schemaFastPath({ type: 'semantic', nearestSemanticCosine: 0.95 });
    expect(r.schemaConsistent).toBe(true);
    expect(r.energy).toBeGreaterThan(0.8);
  });

  test('semantic 低相似 → 慢路径 0.8', () => {
    expect(schemaFastPath({ type: 'semantic', nearestSemanticCosine: 0.5 })).toEqual({ energy: 0.8, schemaConsistent: false });
  });

  test('非 semantic 不触发快路径', () => {
    expect(schemaFastPath({ type: 'episodic', nearestSemanticCosine: 0.99 }).energy).toBe(0.8);
  });

  test('energy 上限 1.0', () => {
    expect(schemaFastPath({ type: 'semantic', nearestSemanticCosine: 1.0 }).energy).toBeLessThanOrEqual(1.0);
  });
});
