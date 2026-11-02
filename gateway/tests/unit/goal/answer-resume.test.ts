import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

describe('answer resume target', () => {
  test('answer is injected into its declared execute node', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    h.write('g9', {
      nextAction: 'WAIT_USER_ANSWER',
      nextNode: 'askUser',
      pendingQuestion: {
        questionId: 'q1', node: 'execute', resumeNode: 'execute', loop: 1,
        questions: ['Which option?'], askedAt: '2026-11-02T00:00:00.000Z',
      },
    });

    expect(h.driver.handleAnswer('g9', 'q1', 'use option B')).toBe(true);
    expect(h.load('g9')).toMatchObject({
      nextNode: 'execute',
      userResponse: { questionId: 'q1', answer: 'use option B', resumeNode: 'execute' },
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const prompt = h.calls.find((c) => c.op === 'promptAsync')?.parts?.[0]?.text ?? '';
    expect(prompt).toContain('Which option?');
    expect(prompt).toContain('use option B');
  });

  test('paused Pod records the answer but does not create a node until resume', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    h.deps.canCreateNode = () => false;
    h.write('g9', {
      nextAction: 'WAIT_USER_ANSWER',
      nextNode: 'askUser',
      pendingQuestion: {
        questionId: 'q1', node: 'execute', resumeNode: 'execute', loop: 1,
        questions: ['Which option?'], askedAt: '2026-11-02T00:00:00.000Z',
      },
    });
    expect(h.driver.handleAnswer('g9', 'q1', 'option C')).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(h.load('g9')).toMatchObject({
      nextNode: 'execute',
      userResponse: { answer: 'option C', resumeNode: 'execute', questions: ['Which option?'] },
    });
    expect(h.calls.some((c) => c.op === 'create')).toBe(false);

    h.deps.canCreateNode = () => true;
    await h.driver.advance('g9');
    expect(h.load('g9')!.nodeSession?.phase).toBe('execute');
  });

  test('a consumed answer is not injected again', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    h.write('g9', {
      nextNode: 'execute',
      userResponse: {
        questionId: 'q1', answer: 'old answer', resumeNode: 'execute',
        respondedAt: '2026-11-02T00:00:00.000Z', consumedByRunId: 4,
      },
    });
    await h.driver.advance('g9');
    const prompt = h.calls.find((c) => c.op === 'promptAsync')?.parts?.[0]?.text ?? '';
    expect(prompt).not.toContain('old answer');
  });
});
