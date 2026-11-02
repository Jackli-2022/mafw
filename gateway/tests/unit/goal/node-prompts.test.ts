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
});
