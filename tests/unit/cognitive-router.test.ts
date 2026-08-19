import { CognitiveRouter, defaultRouterConfig } from '../../gateway/src/core/cost/cognitive-router';

describe('CognitiveRouter', () => {
  it('returns default model when budget is healthy', () => {
    const router = new CognitiveRouter(defaultRouterConfig);
    const result = router.selectModel('execute', 900000, 1000000);
    expect(result.model).toBe(defaultRouterConfig.agents.execute.model);
    expect(result.reason).toBe('default');
  });

  it('downgrades to haiku when budget exceeds threshold', () => {
    const router = new CognitiveRouter(defaultRouterConfig);
    const result = router.selectModel('execute', 100000, 1000000);
    expect(result.model).toBe('haiku');
    expect(result.reason).toBe('budget_threshold');
  });

  it('does not downgrade plan or review agents', () => {
    const router = new CognitiveRouter(defaultRouterConfig);
    const planResult = router.selectModel('plan', 100000, 1000000);
    const reviewResult = router.selectModel('review', 100000, 1000000);
    expect(planResult.model).toBe(defaultRouterConfig.agents.plan.model);
    expect(reviewResult.model).toBe(defaultRouterConfig.agents.review.model);
  });

  it('returns config for all agent types', () => {
    const router = new CognitiveRouter(defaultRouterConfig);
    for (const agent of ['plan', 'execute', 'review'] as const) {
      const result = router.selectModel(agent, 500000, 1000000);
      expect(result.model).toBeTruthy();
      expect(result.reason).toBeTruthy();
    }
  });

  it('accepts partial override config', () => {
    const router = new CognitiveRouter({ agents: { execute: { model: 'haiku', priority: 'cost' } } });
    const result = router.selectModel('execute', 500000, 1000000);
    expect(result.model).toBe('haiku');
  });
});
