import { renderNodePrompt, type NodePromptCtx } from '../../src/core/goal/node-prompts';

const ctx: NodePromptCtx = {
  goalId: 'g1',
  projectDir: 'C:/p',
  mafwDir: 'C:/p/.mafw',
  round: 1,
  maxRounds: 3,
  revision: 2,
  charterPath: 'C:/p/.mafw/goals/g1.md',
  requestPath: 'C:/p/.mafw/requests/g1.json',
  reviewItemsBlock: '【本批人类评审意见】\n- review_1 改这里\n只有用户能确认解决',
};

describe('review work prompt injection', () => {
  test('plan and execute render the review block; review does not', () => {
    expect(renderNodePrompt('plan', ctx)).toContain('review_1');
    expect(renderNodePrompt('execute', ctx)).toContain('review_1');
    expect(renderNodePrompt('review', ctx)).not.toContain('review_1');
  });

  test('without a review block the existing prompt remains unchanged', () => {
    const without = { ...ctx, reviewItemsBlock: undefined };
    expect(renderNodePrompt('plan', without)).not.toContain('本批人类评审意见');
    expect(renderNodePrompt('execute', without)).not.toContain('本批人类评审意见');
  });
});
