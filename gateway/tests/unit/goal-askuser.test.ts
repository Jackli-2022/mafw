import { makeHarness, seedGoal } from './helpers/goal-driver-harness';

describe('askUser 应答链路', () => {
  it('askUser 节点执行时写 ledger asked（断链修复）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser',
      pendingQuestion: { questionId: 'q_1_ok', node: 'plan', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    await h.driver.advance('g1');
    expect(h.ledgerEvents).toEqual([
      expect.objectContaining({ type: 'asked', questionId: 'q_1_ok', goalId: 'g1' }),
    ]);
    expect(h.load('g1')!.nextAction).toBe('WAIT_USER_ANSWER');
  });

  it('handleAnswer：答对 → userResponse 落 state、pendingQuestion 清空、回 plan 并启动', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser', phase: 'ASKING_USER',
      pendingQuestion: { questionId: 'q_1_ok', node: 'plan', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    expect(h.driver.handleAnswer('g1', 'q_1_ok', '用方案B')).toBe(true);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const st = h.load('g1')!;
    expect(st.userResponse).toMatchObject({ questionId: 'q_1_ok', answer: '用方案B' });
    expect(st.pendingQuestion).toBeNull();
    expect(h.ledgerEvents.some((e) => e.type === 'answered')).toBe(true);
    expect(st.nodeSession?.phase).toBe('plan'); // 回 plan 且已启动
  });

  it('handleAnswer：questionId 不匹配 → false 不动 state', () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser',
      pendingQuestion: { questionId: 'q_1_ok', node: 'plan', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    expect(h.driver.handleAnswer('g1', 'q_other', 'x')).toBe(false);
    expect(h.load('g1')!.pendingQuestion).not.toBeNull();
  });

  it('handleCancel → lastError + archive_fail', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser',
      pendingQuestion: { questionId: 'q_1_ok', node: 'review', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    expect(h.driver.handleCancel('g1', 'q_1_ok')).toBe(true);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const st = h.load('g1')!;
    expect(st.lastError).toContain('cancelled');
    expect(st.nextAction).toBe('FAILED');
  });
});
