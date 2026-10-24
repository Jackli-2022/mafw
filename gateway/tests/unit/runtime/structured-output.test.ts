import { StructuredOutputService } from '../../../src/runtime/structured-output';

describe('StructuredOutputService', () => {
  const schema = {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
  };

  it('registers and accepts a valid submission', () => {
    const svc = new StructuredOutputService();
    svc.register('s1', { name: 'x', schema });
    expect(svc.submit('s1', { ok: true })).toEqual({ ok: true, errors: [] });
    expect(svc.submitted('s1')).toEqual({ ok: true });
    expect(svc.get('s1')?.errors).toEqual([]);
  });

  it('rejects invalid data with paths and keeps prior submission', () => {
    const svc = new StructuredOutputService();
    svc.register('s1', { schema });
    svc.submit('s1', { ok: true });
    const bad = svc.submit('s1', { ok: 'yes', extra: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toBe('$.ok: must be of type boolean');
    expect(svc.submitted('s1')).toEqual({ ok: true });
    expect(svc.get('s1')?.errors).toEqual(bad.errors);
  });

  it('no schema → clear 400-style error', () => {
    const svc = new StructuredOutputService();
    expect(svc.submit('missing', {})).toEqual({ ok: false, errors: ['no active output schema'] });
  });

  it('clamps retryCount to 0..3 and exposes spec', () => {
    const svc = new StructuredOutputService();
    svc.register('s1', { schema, retryCount: 9 });
    expect(svc.spec('s1')?.retryCount).toBe(3);
  });

  it('clear removes state', () => {
    const svc = new StructuredOutputService();
    svc.register('s1', { schema });
    svc.clear('s1');
    expect(svc.get('s1')).toBeUndefined();
    expect(svc.size()).toBe(0);
  });
});

describe('structuredInstruction', () => {
  it('contains the tool name and schema JSON', () => {
    const { structuredInstruction } = require('../../../src/runtime/structured-output');
    const text = structuredInstruction({ schema: { type: 'object' } });
    expect(text).toContain('[MAFW STRUCTURED OUTPUT]');
    expect(text).toContain('mafw_submit_result');
    expect(text).toContain('{"type":"object"}');
  });
});
