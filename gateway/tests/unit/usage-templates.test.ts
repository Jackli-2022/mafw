import { USAGE_TEMPLATES, renderTemplate } from '../../src/usage/templates';

const ctx = { readBuiltinSource: () => null };

describe('usage templates', () => {
  it('lists four templates with unique ids', () => {
    const ids = USAGE_TEMPLATES.map(t => t.id);
    expect(ids).toEqual(['balance-api', 'token-plan', 'clone-builtin', 'blank']);
  });

  it('balance-api renders syntactic js embedding values', () => {
    const r = renderTemplate('balance-api', {
      name: 'my-gw', displayName: '我的网关', authMode: 'authKey', authName: 'my-gw',
      endpoint: 'https://x/api/balance', usedPath: 'data.used', limitPath: 'data.limit', remainingPath: 'data.remain',
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(() => new Function(r.content)).not.toThrow();
      expect(r.content).toContain('"my-gw"');
      expect(r.content).toContain('configSchema');
    }
  });

  it('balance-api requires name and endpoint', () => {
    const r = renderTemplate('balance-api', { name: '', endpoint: '' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('token-plan renders pct windows mapping', () => {
    const r = renderTemplate('token-plan', {
      name: 'plan-x', displayName: 'Plan X', authMode: 'none', endpoint: 'https://x/u', listPath: 'items',
      windowField: 'window', pctField: 'pct', usedField: '', limitField: '', resetAtField: 'resetAt',
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(() => new Function(r.content)).not.toThrow();
  });

  it('token-plan requires name and endpoint', () => {
    const r = renderTemplate('token-plan', { name: 'p' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('clone-builtin copies builtin source verbatim with header', () => {
    const r = renderTemplate('clone-builtin', { sourceName: 'deepseek', name: 'deepseek' },
      { readBuiltinSource: (n) => (n === 'deepseek' ? 'module.exports = { name: "deepseek", fetch: async () => null };' : null) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('Cloned from builtin');
      expect(r.content).toContain('module.exports');
      expect(r.name).toBe('deepseek');
    }
  });

  it('clone-builtin fails on unknown source', () => {
    const r = renderTemplate('clone-builtin', { sourceName: 'zzz', name: 'zzz' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('blank renders skeleton with name', () => {
    const r = renderTemplate('blank', { name: 'custom-x' }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(() => new Function(r.content)).not.toThrow();
      expect(r.content).toContain('"custom-x"');
    }
  });
});
