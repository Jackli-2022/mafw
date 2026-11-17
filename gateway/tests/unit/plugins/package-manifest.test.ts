import {
  parsePackageManifest,
  isHostRangeCompatible,
} from '../../../src/plugins/package-manifest';

describe('package manifest v2', () => {
  it('defaults a legacy package to apiVersion 1 / trusted / index.js', () => {
    const result = parsePackageManifest({ name: 'demo' });
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      name: 'demo',
      main: 'index.js',
      apiVersion: 1,
      kind: 'trusted',
      permissions: [],
      legacy: true,
    });
  });

  it('parses apiVersion 2 trust fields', () => {
    const result = parsePackageManifest({
      name: 'demo', version: '1.2.0', main: 'main.js', apiVersion: 2,
      kind: 'untrusted',
      permissions: ['actions', 'config.read'],
      host: '>=5.1.0 <6.0.0',
      deprecated: 'use demo-next',
    });
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      apiVersion: 2, kind: 'untrusted',
      permissions: ['actions', 'config.read'],
      host: '>=5.1.0 <6.0.0',
      deprecated: 'use demo-next',
    });
  });

  it('rejects an unsupported apiVersion', () => {
    const result = parsePackageManifest({ name: 'demo', apiVersion: 3 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('unsupported apiVersion: 3');
  });

  it('rejects untrusted without apiVersion 2', () => {
    const result = parsePackageManifest({ name: 'demo', kind: 'untrusted' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('untrusted requires apiVersion 2');
  });

  it('rejects unknown permission tokens', () => {
    const result = parsePackageManifest({
      name: 'demo', apiVersion: 2, permissions: ['actions', 'root'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('unknown permission: root');
  });

  it('compares host ranges against the product version', () => {
    expect(isHostRangeCompatible('>=5.1.0 <6.0.0', '5.1.0')).toBe(true);
    expect(isHostRangeCompatible('>=5.1.0 <6.0.0', '5.9.9')).toBe(true);
    expect(isHostRangeCompatible('>=5.1.0 <6.0.0', '6.0.0')).toBe(false);
    expect(isHostRangeCompatible(undefined, '5.1.0')).toBe(true);
    expect(isHostRangeCompatible('not a range', '5.1.0')).toBe(false);
  });

  it('normalizes a valid contributes block', () => {
    const result = parsePackageManifest({
      name: 'demo', apiVersion: 2,
      contributes: { gateway: { actions: ['ping'], http: false } },
    });
    expect(result.ok).toBe(true);
    expect(result.manifest?.contributes?.gateway?.actions).toEqual(['ping']);
    expect(result.manifest?.contributes?.gateway?.http).toBe(false);
  });

  it('rejects an invalid contributes block at apiVersion 2', () => {
    const result = parsePackageManifest({
      name: 'demo', apiVersion: 2,
      contributes: { gateway: { actions: 'ping' } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('; ')).toContain('contributes');
  });

  it('downgrades an invalid contributes block to a warning at apiVersion 1', () => {
    const result = parsePackageManifest({
      name: 'demo',
      contributes: { gateway: { actions: 'ping' } },
    });
    expect(result.ok).toBe(true);
    expect(result.manifest?.contributes).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('legacy-contributes'))).toBe(true);
  });

  it('stores a valid contributes block at apiVersion 1 so it can bind', () => {
    const result = parsePackageManifest({
      name: 'demo',
      contributes: { gateway: { actions: ['ping'] } },
    });
    expect(result.ok).toBe(true);
    expect(result.manifest?.contributes?.gateway?.actions).toEqual(['ping']);
  });

  // `standardVersion` names the manifest standard the package was written
  // against. It is optional (legacy manifests predate it) and only carries a
  // positive integer: the parser is the one place that decides, and the
  // published JSON Schema mirrors this rule exactly.
  it('accepts a positive integer standardVersion', () => {
    const result = parsePackageManifest({ name: 'demo', standardVersion: 1 });
    expect(result.ok).toBe(true);
    expect(result.manifest?.standardVersion).toBe(1);
  });

  it('rejects a standardVersion that is not a positive integer', () => {
    for (const standardVersion of [0, -1, 1.5, 'v1', null, true]) {
      const result = parsePackageManifest({ name: 'demo', standardVersion });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('standardVersion must be a positive integer');
    }
  });
});
