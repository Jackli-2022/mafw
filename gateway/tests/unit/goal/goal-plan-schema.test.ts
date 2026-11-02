import { planOutputSchema } from '../../../src/core/goal/node-prompts';
import { validateJsonSchema } from '../../../src/runtime/json-schema';

function goalEval() {
  return {
    outcome: '标签按项目恢复',
    conditions: [
      { id: 'g1', statement: '刷新后恢复', required: true, evidence: '单测', method: 'npm test' },
    ],
    failureConditions: ['刷新后丢失'],
    constraints: [],
    nonGoals: [],
    mapping: { g1: { tasks: ['w1-t1'] } },
  };
}

function readyWaves(tasks: unknown[]) {
  return {
    status: 'ready',
    taskType: 'feature',
    waves: [{ id: 'w1', title: 'Wave', riskNote: 'risk', tasks }],
    goalEval: goalEval(),
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

  test('requires the Goal Eval leg of the plan package', () => {
    const schema = planOutputSchema();
    const withoutEval: any = readyWaves(['legacy']);
    delete withoutEval.goalEval;
    expect(validateJsonSchema(schema as any, withoutEval).length).toBeGreaterThan(0);

    const emptyEval: any = readyWaves(['legacy']);
    emptyEval.goalEval = { ...goalEval(), conditions: [] };
    expect(validateJsonSchema(schema as any, emptyEval).length).toBeGreaterThan(0);

    const missingEvidence: any = readyWaves(['legacy']);
    missingEvidence.goalEval = {
      ...goalEval(),
      conditions: [{ id: 'g1', statement: 'x', required: true, method: 'npm test' }],
    };
    expect(validateJsonSchema(schema as any, missingEvidence).length).toBeGreaterThan(0);
  });
});
