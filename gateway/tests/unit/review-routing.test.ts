import { routeAfterReview } from '../../src/core/langgraph/graph';

function state(overrides: Record<string, unknown>): any {
  return {
    reviewVerdict: 'FAIL',
    lastError: undefined,
    round: 1,
    maxRounds: 3,
    pendingQuestion: undefined,
    ...overrides,
  };
}

describe('routeAfterReview ERROR semantics', () => {
  it('routes malformed-report ERROR to plan retry (not terminal archive_fail)', () => {
    expect(routeAfterReview(state({ reviewVerdict: 'ERROR' }))).toBe('plan');
  });

  it('routes ERROR past maxRounds to archive_max_retries (bounded)', () => {
    expect(routeAfterReview(state({ reviewVerdict: 'ERROR', round: 3, maxRounds: 3 }))).toBe(
      'archive_max_retries'
    );
  });

  it('keeps lastError terminal (missing artifacts / infra failure)', () => {
    expect(routeAfterReview(state({ reviewVerdict: 'ERROR', lastError: 'review report not found' }))).toBe(
      'archive_fail'
    );
  });

  it('preserves existing FAIL/PASS routing', () => {
    expect(routeAfterReview(state({ reviewVerdict: 'FAIL' }))).toBe('plan');
    expect(routeAfterReview(state({ reviewVerdict: 'FAIL', round: 3, maxRounds: 3 }))).toBe(
      'archive_max_retries'
    );
    expect(routeAfterReview(state({ reviewVerdict: 'PASS' }))).toBe('archive_success');
    expect(routeAfterReview(state({ reviewVerdict: 'FAIL', pendingQuestion: { questionId: 'q1' } }))).toBe(
      'askUser'
    );
  });
});
