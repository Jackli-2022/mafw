import { estimateTokens, estimateCost, generateCostId } from '../../src/cost/types';

describe('Cost Types', () => {
  it('estimates zero tokens for file tools', () => {
    expect(estimateTokens('file_edit', 'some content')).toBe(0);
    expect(estimateTokens('mafw_observe', 'some content')).toBe(0);
  });

  it('estimates tokens for LLM calls based on input length', () => {
    const result = estimateTokens('mafw_review', 'a'.repeat(100));
    expect(result).toBe(25);
  });

  it('calculates cost based on token count and model rate', () => {
    const sonnetCost = estimateCost(1000, 'sonnet');
    expect(sonnetCost).toBeCloseTo(0.003, 4);

    const haikuCost = estimateCost(1000, 'haiku');
    expect(haikuCost).toBeCloseTo(0.0015, 4);
  });

  it('generates unique cost IDs', () => {
    const a = generateCostId();
    const b = generateCostId();
    expect(a).not.toBe(b);
  });
});
