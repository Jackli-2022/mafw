import { routeAfterReview, routeAfterPlan } from '../../../gateway/src/core/langgraph/graph';

describe('routeAfterReview', () => {
  it('routes to archive_success on PASS', () => {
    const result = routeAfterReview({
      reviewVerdict: 'PASS',
      round: 1,
      maxRounds: 3,
      lastError: null,
    } as any);
    expect(result).toBe('archive_success');
  });

  it('routes to archive_fail on ERROR', () => {
    const result = routeAfterReview({
      reviewVerdict: 'ERROR',
      round: 1,
      maxRounds: 3,
      lastError: 'timeout',
    } as any);
    expect(result).toBe('archive_fail');
  });

  it('routes back to plan on FAIL when rounds remain', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL',
      round: 1,
      maxRounds: 3,
      lastError: null,
    } as any);
    expect(result).toBe('plan');
  });

  it('routes to archive_max_retries on FAIL when maxRounds reached', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL',
      round: 3,
      maxRounds: 3,
      lastError: null,
    } as any);
    expect(result).toBe('archive_max_retries');
  });

  it('routes to askUser on FAIL with pendingQuestion', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL',
      round: 1,
      maxRounds: 3,
      lastError: null,
      pendingQuestion: { questionId: 'q2', node: 'review', loop: 1, questions: ['critical issue'], askedAt: '' },
    } as any);
    expect(result).toBe('askUser');
  });
});

describe('routeAfterPlan', () => {
  it('routes to askUser when pendingQuestion is set', () => {
    expect(routeAfterPlan({
      pendingQuestion: { questionId: 'q1', node: 'plan', loop: 1, questions: ['?'], askedAt: '' },
      round: 1,
      maxRounds: 3,
      reviewVerdict: 'FAIL',
      lastError: null,
    } as any)).toBe('askUser');
  });

  it('routes to execute when no pendingQuestion', () => {
    expect(routeAfterPlan({ pendingQuestion: null, round: 1, maxRounds: 3 } as any)).toBe('execute');
  });
});
