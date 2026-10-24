import { nodeOutputSchema } from '../../../../src/core/goal/node-prompts';
import { validateJsonSchema } from '../../../../src/runtime/json-schema';

describe('nodeOutputSchema', () => {
  it('plan ready passes', () => {
    const spec = nodeOutputSchema('plan');
    expect(spec.name).toBe('goal.plan');
    expect(validateJsonSchema(spec.schema, {
      status: 'ready', taskType: 'feature',
      waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }],
    })).toEqual([]);
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
    });
    expect(errs.some((e) => e.path.includes('riskNote'))).toBe(true);
    expect(validateJsonSchema(spec.schema, { status: 'need_clarification', ambiguities: [] }).length).toBeGreaterThan(0);
  });

  it('execute / review schemas', () => {
    expect(validateJsonSchema(nodeOutputSchema('execute').schema, {
      goalId: 'g1', receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'ok' }],
    })).toEqual([]);
    expect(validateJsonSchema(nodeOutputSchema('review').schema, { verdict: 'PASS', feedback: 'ok' })).toEqual([]);
    expect(validateJsonSchema(nodeOutputSchema('review').schema, { verdict: 'MAYBE', feedback: 'x' }).length).toBeGreaterThan(0);
  });
});
