import * as fs from 'fs';
import * as path from 'path';
import { renderNodePrompt } from '../../../../src/core/goal/node-prompts';

const CTX = {
  goalId: 'goal-format',
  revision: 1,
  mafwDir: 'C:/tmp/.mafw',
  projectDir: 'C:/tmp/project',
  loop: 1,
  maxLoops: 3,
  acceptance: { 'w1-t1': ['task one acceptance'] },
  goalConditions: [{ id: 'g1', statement: 'goal condition', required: true, evidence: 'evidence', method: 'method' }],
} as any;

describe('review report format contract', () => {
  it('the review prompt requires the machine-readable block and every rubric field', () => {
    const prompt = renderNodePrompt('review', CTX);
    expect(prompt).toContain('```mafw-review');
    expect(prompt).toContain('"tasks"');
    expect(prompt).toContain('"goalResults"');
    expect(prompt).toContain('缺一个即判为无效评审');
    expect(prompt).toContain('评审无效');
    expect(prompt).toContain('第一段');
  });

  it('the mafw-review skill documents the same schema as the parser', () => {
    const skill = fs.readFileSync(
      path.join(process.cwd(), '..', '.opencode', 'skills', 'mafw-review', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('```mafw-review');
    expect(skill).toContain('"tasks"');
    expect(skill).toContain('"goalResults"');
    expect(skill).toContain('"feedback"');
    expect(skill).toContain('第一段');
    expect(skill).not.toContain('"metrics"');
  });
});
