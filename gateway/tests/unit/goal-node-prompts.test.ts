import * as path from 'path';
import { nodeArtifactPaths, renderNodePrompt } from '../../src/core/goal/node-prompts';

describe('nodeArtifactPaths', () => {
  it('receipts 按 loop 分文件（不再覆盖）；waves/review 路径稳定', () => {
    const p = nodeArtifactPaths('C:/m', 'g1', 2);
    expect(p.receipt.replace(/\\/g, '/')).toContain('receipts/g1/loop-2-receipt.json');
    expect(p.waves).toContain('waves.json');
    expect(p.review).toContain('g1-loop2.md');
  });
});

describe('renderNodePrompt', () => {
  const ctx = {
    goalId: 'g1', projectDir: 'C:/p', mafwDir: 'C:/m', round: 2, maxRounds: 3,
    charterPath: 'C:/m/goals/g1.md', requestPath: 'C:/m/requests/g1.json',
    reviewFeedback: '测试没跑',
  };

  it('plan prompt 含产物路径与格式示例，且不含 /skill 字样', () => {
    const p = renderNodePrompt('plan', ctx);
    expect(p).toContain('waves.json');
    expect(p).toContain('need_clarification');
    expect(p).not.toContain('/skill');
    expect(p).toContain('测试没跑'); // round>1 带上轮 feedback
  });

  it('execute prompt 含 per-loop receipt 路径', () => {
    const p = renderNodePrompt('execute', ctx);
    expect(p).toContain('loop-2-receipt.json');
    expect(p).toContain('receipts');
  });

  it('review prompt 含 review 路径 + mafw-review 围栏 + 上轮 feedback', () => {
    const p = renderNodePrompt('review', ctx);
    expect(p).toContain('g1-loop2.md');
    expect(p).toContain('mafw-review');
    expect(p).toContain('测试没跑');
  });
});
