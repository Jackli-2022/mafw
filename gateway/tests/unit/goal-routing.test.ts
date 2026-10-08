import { routeAfterPlan, routeAfterReview, routeNext } from '../../src/core/goal/routing';

const base = {
  lastError: null as string | null,
  reviewVerdict: null as 'PASS' | 'FAIL' | 'ERROR' | null,
  round: 1,
  maxRounds: 3,
  pendingQuestion: null as any,
};

describe('routeAfterPlan', () => {
  it('pendingQuestion → askUser', () => {
    expect(routeAfterPlan({ ...base, pendingQuestion: { questionId: 'q1' } })).toBe('askUser');
  });
  it('无 pendingQuestion → execute', () => {
    expect(routeAfterPlan(base)).toBe('execute');
  });
});

describe('routeAfterReview（语义逐字移植 graph.ts:4-10）', () => {
  it('lastError → archive_fail（最高优先）', () => {
    expect(routeAfterReview({ ...base, lastError: 'x', reviewVerdict: 'PASS' })).toBe('archive_fail');
  });
  it('PASS → archive_success（先于 maxRounds）', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'PASS', round: 9 })).toBe('archive_success');
  });
  it('round>=maxRounds → archive_max_retries', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'FAIL', round: 3, maxRounds: 3 })).toBe('archive_max_retries');
  });
  it('FAIL round<max 且 pendingQuestion → askUser', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'FAIL', round: 1, pendingQuestion: { questionId: 'q1' } })).toBe('askUser');
  });
  it('否则 → plan', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'FAIL', round: 1 })).toBe('plan');
  });
});

describe('routeNext', () => {
  it('stage 决定入口', () => {
    expect(routeNext('after_plan', base)).toBe('execute');
    expect(routeNext('after_execute', base)).toBe('review');
    expect(routeNext('after_review', { ...base, reviewVerdict: 'PASS' })).toBe('archive_success');
    expect(routeNext('start', base)).toBe('plan');
  });
});
