import { nodeOutputSchema, renderNodePrompt, nodeArtifactPaths } from '../../../src/core/goal/node-prompts';

describe('review rubric contract', () => {
  test('review schema requires per-task results with evidence', () => {
    const spec: any = nodeOutputSchema('review');
    const schema = spec.schema;
    expect(schema.required).toEqual(expect.arrayContaining(['verdict', 'tasks', 'feedback']));
    expect(schema.properties.tasks).toMatchObject({ type: 'array' });
    expect(schema.properties.tasks.items.required).toEqual(expect.arrayContaining(['taskId', 'result', 'evidence']));
    expect(schema.properties.tasks.items.properties.result.enum).toEqual(['pass', 'fail', 'skipped']);
  });

  test('review prompt tells the reviewer to cover every wave task', () => {
    const a = nodeArtifactPaths('/tmp/mafw', 'g1', 1);
    const prompt = renderNodePrompt('review', {
      mafwDir: '/tmp/mafw',
      goalId: 'g1',
      round: 1,
      maxRounds: 3,
      charterPath: '/tmp/mafw/charter.md',
      requestPath: '/tmp/mafw/request.md',
    } as any);
    expect(prompt).toContain(a.review);
    expect(prompt).toContain('tasks');
    expect(prompt).toContain('taskId');
    expect(prompt).toContain('evidence');
    expect(prompt).toContain('每一个');
  });
});
