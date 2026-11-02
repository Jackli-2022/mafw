import { planOutputSchema } from '../../../src/core/goal/node-prompts';
import { validateJsonSchema } from '../../../src/runtime/json-schema';

function readyWaves(tasks: unknown[]) {
  return {
    status: 'ready',
    taskType: 'feature',
    waves: [{ id: 'w1', title: 'Wave', riskNote: 'risk', tasks }],
  };
}

describe('plan output schema', () => {
  test('accepts object tasks with acceptance and legacy strings', () => {
    const schema = planOutputSchema();
    const ok = (tasks: unknown[]) => validateJsonSchema(schema as any, readyWaves(tasks));
    expect(ok([{ title: 'fix', acceptance: ['tests pass'] }])).toHaveLength(0);
    expect(ok(['legacy'])).toHaveLength(0);
    expect(ok([{ title: 'fix', acceptance: 'not-array' }]).length).toBeGreaterThan(0);
  });
});
