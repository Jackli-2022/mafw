import { routeAfterReview } from '../../../src/langgraph/graph';

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
});
