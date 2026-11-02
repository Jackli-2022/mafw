import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

describe('one-time plan approvals', () => {
  test('wrong, missing and replayed ids are rejected without advancing', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    h.write('g9', {
      nextAction: 'AWAIT_PLAN_APPROVAL',
      nextNode: 'execute',
      planApproval: { id: 'pa_1', status: 'pending', round: 1 },
    });

    expect(await h.driver.approvePlan('g9', 'wrong')).toBe(false);
    expect(await h.driver.approvePlan('g9')).toBe(false);
    expect(h.load('g9')!.planApproval?.status).toBe('pending');
    expect(await h.driver.approvePlan('g9', 'pa_1')).toBe(true);
    expect(await h.driver.approvePlan('g9', 'pa_1')).toBe(false);
    expect(h.load('g9')!.planApproval?.status).toBe('approved');
  });

  test('legacy pending approval without id can complete once', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    h.write('g9', {
      nextAction: 'AWAIT_PLAN_APPROVAL',
      nextNode: 'execute',
      planApproval: { status: 'pending', round: 1 } as any,
    });
    expect(await h.driver.approvePlan('g9')).toBe(true);
    expect(await h.driver.approvePlan('g9')).toBe(false);
  });
});
