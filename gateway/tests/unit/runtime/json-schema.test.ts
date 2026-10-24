import { validateJsonSchema } from '../../../src/runtime/json-schema';

describe('validateJsonSchema (structured output subset)', () => {
  const plan = {
    type: 'object',
    required: ['taskType', 'waves', 'status'],
    properties: {
      taskType: { type: 'string', enum: ['feature', 'bugfix'] },
      status: { type: 'string', enum: ['ready'] },
      waves: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'title'],
          properties: { id: { type: 'string' }, title: { type: 'string' } },
        },
      },
    },
  };

  it('accepts a valid plan', () => {
    expect(validateJsonSchema(plan, {
      taskType: 'feature', status: 'ready',
      waves: [{ id: 'w1', title: 'do it' }],
    })).toEqual([]);
  });

  it('reports required + nested paths', () => {
    const errs = validateJsonSchema(plan, { status: 'ready', waves: [{ id: 'w1' }] });
    expect(errs).toContainEqual({ path: '$.taskType', message: 'is required' });
    expect(errs).toContainEqual({ path: '$.waves[0].title', message: 'is required' });
  });

  it('reports enum / type / minItems', () => {
    const errs = validateJsonSchema(plan, { taskType: 'other', status: 'ready', waves: [] });
    expect(errs.some(e => e.path === '$.taskType' && e.message.includes('must be one of'))).toBe(true);
    expect(errs.some(e => e.path === '$.waves' && e.message.includes('at least 1'))).toBe(true);
  });

  it('rejects extra properties when additionalProperties:false', () => {
    const errs = validateJsonSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }, { a: 'x', b: 1 });
    expect(errs).toEqual([{ path: '$.b', message: 'is not allowed (additionalProperties:false)' }]);
  });

  it('supports anyOf (plan ready | need_clarification)', () => {
    const schema = {
      anyOf: [
        { type: 'object', required: ['status', 'waves'], properties: { status: { const: 'ready' } } },
        { type: 'object', required: ['status', 'ambiguities'], properties: { status: { const: 'need_clarification' } } },
      ],
    };
    expect(validateJsonSchema(schema, { status: 'need_clarification', ambiguities: ['?'] })).toEqual([]);
    expect(validateJsonSchema(schema, { status: 'ready' })[0].message).toContain('anyOf');
  });

  it('supports pattern / integer / uniqueItems', () => {
    expect(validateJsonSchema({ type: 'string', pattern: '^w[0-9]+$' }, 'w1')).toEqual([]);
    expect(validateJsonSchema({ type: 'string', pattern: '^w[0-9]+$' }, 'x1')[0].message).toContain('pattern');
    expect(validateJsonSchema({ type: 'integer' }, 1.5)[0].message).toContain('integer');
    expect(validateJsonSchema({ type: 'array', uniqueItems: true }, ['a', 'a'])[0].path).toBe('$[1]');
  });

  it('fails loudly on unsupported $ref', () => {
    const errs = validateJsonSchema({ $ref: '#/components/schemas/X' }, {});
    expect(errs).toEqual([{ path: '$', message: 'unsupported schema keyword: $ref/$defs' }]);
  });
});
