import { formatAgentPriors, AGENT_PRIORS_BUDGET } from '../../../src/recall/inject-format';

describe('formatAgentPriors', () => {
  it('renders axioms + failure patterns within budget', () => {
    const { block, used } = formatAgentPriors({
      axioms: ['子进程 spawn 必须 windowsHide'],
      heuristics: [],
      failurePatterns: ['serve 崩溃后事件订阅必须重连'],
    });
    expect(block).toContain('<agent-priors>');
    expect(block).toContain('子进程 spawn 必须 windowsHide');
    expect(block).toContain('serve 崩溃后事件订阅必须重连');
    expect(used).toBe(2);
  });

  it('returns null block when all inputs empty', () => {
    expect(formatAgentPriors({ axioms: [], heuristics: [], failurePatterns: [] }).block).toBeNull();
  });

  it('hard-caps total chars', () => {
    const long = 'x'.repeat(400);
    const { block } = formatAgentPriors({
      axioms: [long, long, long],
      heuristics: [],
      failurePatterns: [long],
    });
    // 块头尾固定开销外的正文不超过预算
    expect(block!.length).toBeLessThanOrEqual(AGENT_PRIORS_BUDGET.maxChars + 200);
  });
});
