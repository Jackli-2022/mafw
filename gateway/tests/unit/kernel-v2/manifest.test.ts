import { validateCapabilityManifest } from '../../../src/kernel-v2/manifest';

const minimal = {
  id: 'tts-mimo',
  version: '1.0.0',
  apiVersion: 1,
  kind: 'trusted',
  provides: [{ capability: 'tts', version: 1 }],
};

function errorsOf(input: unknown, options?: Parameters<typeof validateCapabilityManifest>[1]): string {
  const result = validateCapabilityManifest(input, options);
  return result.ok ? '' : result.errors.join('; ');
}

describe('validateCapabilityManifest', () => {
  test('accepts a minimal gateway provider manifest and defaults planes/activation', () => {
    const result = validateCapabilityManifest(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activation).toBe('startup');
    expect(result.value.planes).toEqual(['gateway']);
  });

  test('rejects invalid id, version and apiVersion', () => {
    expect(errorsOf({ ...minimal, id: 'bad id' })).toMatch(/id/);
    expect(errorsOf({ ...minimal, version: '' })).toMatch(/version/);
    expect(errorsOf({ ...minimal, apiVersion: 0 })).toMatch(/apiVersion/);
  });

  test('rejects unknown kind, activation and plane', () => {
    expect(errorsOf({ ...minimal, kind: 'plugin' })).toMatch(/kind/);
    expect(errorsOf({ ...minimal, activation: 'eager' })).toMatch(/activation/);
    expect(errorsOf({ ...minimal, planes: ['desktop'] })).toMatch(/plane/);
  });

  test('core requires a first-party allowlist entry', () => {
    expect(errorsOf({ ...minimal, kind: 'core' })).toMatch(/core.*allowlist/i);
    const allowed = validateCapabilityManifest(
      { ...minimal, kind: 'core' },
      { firstPartyAllowlist: new Set(['tts-mimo']) },
    );
    expect(allowed.ok).toBe(true);
  });

  test('accepts an untrusted manifest shape (activation policy rejects later)', () => {
    expect(validateCapabilityManifest({ ...minimal, kind: 'untrusted' }).ok).toBe(true);
  });

  test('validates provides, requires and wants', () => {
    expect(errorsOf({ ...minimal, provides: [] })).toMatch(/provides/);
    expect(
      errorsOf({
        ...minimal,
        provides: [
          { capability: 'tts', version: 1 },
          { capability: 'tts', version: 2 },
        ],
      }),
    ).toMatch(/duplicate/);
    expect(errorsOf({ ...minimal, requires: ['ok', 42] })).toMatch(/requires/);
    expect(errorsOf({ ...minimal, wants: 'usage' })).toMatch(/wants/);
  });

  test('validates integrity shape', () => {
    expect(
      errorsOf({ ...minimal, integrity: { algorithm: 'md5', files: {} } }),
    ).toMatch(/integrity/);
    expect(
      errorsOf({ ...minimal, integrity: { algorithm: 'sha256', files: 'nope' } }),
    ).toMatch(/integrity/);
  });

  test('rejects unknown fields', () => {
    expect(errorsOf({ ...minimal, extra: true })).toMatch(/unknown field "extra"/);
  });

  test('rejects duplicate planes', () => {
    expect(errorsOf({ ...minimal, planes: ['gateway', 'gateway'] })).toMatch(/duplicate/);
  });
});
