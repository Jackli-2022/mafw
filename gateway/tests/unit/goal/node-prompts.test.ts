import { renderNodePrompt, type NodePromptCtx } from '../../../src/core/goal/node-prompts';

const ctx: NodePromptCtx = {
  goalId: 'g1',
  projectDir: 'C:/p',
  mafwDir: 'C:/p/.mafw',
  round: 1,
  maxRounds: 3,
  charterPath: 'C:/p/.mafw/goals/g1.md',
  requestPath: 'C:/p/.mafw/requests/g1.json',
  goalAcceptance: ['pods.tasks.delete returns 200'],
};

describe('goal node prompts', () => {
  test('plan prompt requires decomposing goal acceptance', () => {
    const prompt = renderNodePrompt('plan', ctx);
    expect(prompt).toContain('Goal acceptance');
    expect(prompt).toContain('pods.tasks.delete returns 200');
    expect(prompt).toContain('decompose');
  });

  test('execute prompt does not repeat goal-level acceptance', () => {
    expect(renderNodePrompt('execute', ctx)).not.toContain('pods.tasks.delete returns 200');
  });

  test('retry prompt includes attempt and structured last failure', () => {
    const prompt = renderNodePrompt('execute', {
      ...ctx,
      attempt: 2,
      maxAttempts: 2,
      lastFailure: {
        class: 'terminal_session',
        code: '429',
        message: 'provider overloaded',
        node: 'execute',
        attempt: 1,
        at: '2026-11-02T00:00:00.000Z',
      },
    });
    expect(prompt).toContain('attempt 2/2');
    expect(prompt).toContain('429');
    expect(prompt).toContain('existing artifacts');
  });
});
