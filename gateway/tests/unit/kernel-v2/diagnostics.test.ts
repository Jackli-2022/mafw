import { createKernelDiagnostic, sanitizeKernelDiagnostic } from '../../../src/kernel-v2/diagnostics';

const base = {
  providerId: 'tts-mimo',
  capability: 'tts',
  version: '1.0.0',
  plane: 'gateway' as const,
  state: 'active' as const,
  revision: 'boot-1:1',
};

describe('kernel diagnostics', () => {
  test('creates a diagnostic with all fields and an ISO timestamp', () => {
    const item = createKernelDiagnostic(base);
    expect(item.providerId).toBe('tts-mimo');
    expect(item.capability).toBe('tts');
    expect(item.plane).toBe('gateway');
    expect(item.state).toBe('active');
    expect(item.revision).toBe('boot-1:1');
    expect(Number.isNaN(Date.parse(item.at))).toBe(false);
  });

  test('sanitize drops unknown fields, including Host code and secrets', () => {
    const item = sanitizeKernelDiagnostic({
      ...base,
      reason: 'fallback',
      secret: 'sk-do-not-leak',
      handler: () => 'nope',
      extra: { nested: true },
    });
    expect(item).not.toBeNull();
    expect(item).not.toHaveProperty('secret');
    expect(item).not.toHaveProperty('handler');
    expect(item).not.toHaveProperty('extra');
    expect(item?.reason).toBe('fallback');
  });

  test('sanitize fails closed on missing or invalid required fields', () => {
    expect(sanitizeKernelDiagnostic({})).toBeNull();
    expect(sanitizeKernelDiagnostic({ ...base, plane: 'desktop' })).toBeNull();
    expect(sanitizeKernelDiagnostic({ ...base, state: 'running' })).toBeNull();
    expect(sanitizeKernelDiagnostic({ ...base, providerId: '' })).toBeNull();
  });
});
