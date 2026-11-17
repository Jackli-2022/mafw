import { buildRejectOpeningPrompt } from '../../src/core/pod/pod-goal-service';

describe('reject opening review context', () => {
  test('carries new revision review items once', () => {
    const prompt = buildRejectOpeningPrompt({
      rejectedRevision: 1,
      revision: 2,
      feedback: '请按批注修改',
      verdict: 'UNREVIEWED',
      reviewItemsBlock: '【本批人类评审意见】\n- review_new · 改这里\n只有用户能确认解决',
    });
    expect(prompt).toContain('review_new');
    expect(prompt.match(/review_new/g)).toHaveLength(1);
    expect(prompt).toContain('只有用户能确认解决');
  });
});
