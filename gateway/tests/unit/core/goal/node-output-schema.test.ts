import { nodeOutputSchema } from '../../../../src/core/goal/node-prompts';
import { validateJsonSchema } from '../../../../src/runtime/json-schema';

/** Task 13：plan 交卷是 PlanPackage（waves + goalEval）。 */
function goalEval() {
  return {
    outcome: 'goal met',
    conditions: [{ id: 'g1', statement: 'works', required: true, evidence: 'tests', method: 'npm test' }],
    failureConditions: [],
    constraints: [],
    nonGoals: [],
    mapping: { g1: { tasks: ['w1-t1'] } },
  };
}

describe('nodeOutputSchema', () => {
  it('plan ready passes', () => {
    const spec = nodeOutputSchema('plan');
    expect(spec.name).toBe('goal.plan');
    expect(validateJsonSchema(spec.schema, {
      status: 'ready', taskType: 'feature',
      waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }],
      goalEval: goalEval(),
    })).toEqual([]);
  });

  it('plan ready without goalEval is rejected', () => {
    const spec = nodeOutputSchema('plan');
    const errs = validateJsonSchema(spec.schema, {
      status: 'ready', taskType: 'feature',
      waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }],
    });
    expect(errs.some((e) => e.path.includes('goalEval'))).toBe(true);
  });

  it('plan need_clarification passes', () => {
    const spec = nodeOutputSchema('plan');
    expect(validateJsonSchema(spec.schema, { status: 'need_clarification', ambiguities: ['A?'] })).toEqual([]);
  });

  it('plan rejects missing riskNote / empty waves', () => {
    const spec = nodeOutputSchema('plan');
    const errs = validateJsonSchema(spec.schema, {
      status: 'ready', taskType: 'feature',
      waves: [{ id: 'w1', title: 't', tasks: [] }],
      goalEval: goalEval(),
    });
    expect(errs.some((e) => e.path.includes('riskNote'))).toBe(true);
    expect(validateJsonSchema(spec.schema, { status: 'need_clarification', ambiguities: [] }).length).toBeGreaterThan(0);
  });

  it('execute / review schemas', () => {
    expect(validateJsonSchema(nodeOutputSchema('execute').schema, {
      goalId: 'g1', receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'ok' }],
    })).toEqual([]);
    expect(validateJsonSchema(nodeOutputSchema('review').schema, {
      verdict: 'PASS',
      tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test' }],
      feedback: 'ok',
    })).toEqual([]);
    expect(validateJsonSchema(nodeOutputSchema('review').schema, { verdict: 'PASS', feedback: 'ok' }).length).toBeGreaterThan(0);
    expect(validateJsonSchema(nodeOutputSchema('review').schema, {
      verdict: 'PASS', tasks: [{ taskId: 'w1-t1', result: 'maybe', evidence: 'x' }], feedback: 'ok',
    }).length).toBeGreaterThan(0);
    expect(validateJsonSchema(nodeOutputSchema('review').schema, { verdict: 'MAYBE', feedback: 'x' }).length).toBeGreaterThan(0);
  });
});
