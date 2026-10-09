import { renderNodePrompt, NodePromptCtx } from '../../../../src/core/goal/node-prompts';

const ctx = (extra: Partial<NodePromptCtx> = {}): NodePromptCtx => ({
  goalId: 'g1',
  projectDir: '/p',
  mafwDir: '/m',
  round: 1,
  maxRounds: 3,
  charterPath: '/m/goals/g1.md',
  requestPath: '/m/requests/g1.json',
  ...extra,
});

describe('renderNodePrompt priorBlock (W4)', () => {
  it('plan prompt includes priorBlock when provided', () => {
    const p = renderNodePrompt('plan', ctx({ priorBlock: '### 历史\nPASS 率 50%' }));
    expect(p).toContain('PASS 率 50%');
  });

  it('plan prompt omits priorBlock when absent', () => {
    expect(renderNodePrompt('plan', ctx())).not.toContain('### 历史');
  });

  it('execute prompt never includes priorBlock', () => {
    expect(renderNodePrompt('execute', ctx({ priorBlock: 'PRIOR_X' }))).not.toContain('PRIOR_X');
  });
});
