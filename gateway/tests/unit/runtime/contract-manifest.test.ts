import {
  buildRuntimeContractManifest,
  validateManifest,
  type RuntimeContractManifest,
} from '../../../src/runtime/contract-manifest';

function fixture(overrides: Partial<RuntimeContractManifest> = {}): RuntimeContractManifest {
  return {
    schemaVersion: 1,
    contractVersion: 'test',
    generatedFrom: 'gateway/src/runtime/contract-manifest.ts',
    domains: [{ id: 'session', title: 'Session', description: '' }],
    surfaces: [],
    capabilities: [],
    events: [],
    cognition: [],
    presets: [],
    ...overrides,
  };
}

describe('runtime contract manifest invariants', () => {
  it('accepts an empty well-formed manifest', () => {
    expect(validateManifest(fixture())).toEqual([]);
  });

  it('rejects duplicate surface ids', () => {
    const errors = validateManifest(fixture({
      surfaces: [
        { id: 'session.create', title: 'create', direction: 'gateway->runtime', domain: 'session', obligation: 'required', verification: 'presence', implementation: 'session.create', probe: ['session', 'create'], consumer: 'test', impact: 'x' },
        { id: 'session.create', title: 'create again', direction: 'gateway->runtime', domain: 'session', obligation: 'required', verification: 'presence', implementation: 'session.create', probe: ['session', 'create'], consumer: 'test', impact: 'x' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/duplicate surface id/i);
  });

  it('rejects gated without capability and requiredWhen on non-required', () => {
    const errors = validateManifest(fixture({
      surfaces: [
        { id: 'session.fork', title: 'fork', direction: 'gateway->runtime', domain: 'branch', obligation: 'gated', verification: 'presence', implementation: 'session.fork', probe: ['session', 'fork'], consumer: 'test', impact: 'x' },
        { id: 'session.update', title: 'rename', direction: 'gateway->runtime', domain: 'session', obligation: 'optional', requiredWhen: { capabilities: ['eventStream'] }, verification: 'presence', implementation: 'session.update', probe: ['session', 'update'], consumer: 'test', impact: 'x' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/gated.*capability/i);
    expect(errors.join('\n')).toMatch(/requiredWhen.*required/i);
  });

  it('rejects behavior/conformance/attested surfaces without their probe data', () => {
    const errors = validateManifest(fixture({
      surfaces: [
        { id: 'prompt.result.usage', title: 'usage', direction: 'gateway->runtime', domain: 'prompt', obligation: 'optional', verification: 'behavior', implementation: 'prompt', consumer: 'test', impact: 'x' },
        { id: 'turn.terminal', title: 'terminal', direction: 'gateway->runtime', domain: 'events', obligation: 'optional', verification: 'conformance', implementation: 'event', consumer: 'test', impact: 'x' },
        { id: 'turnBudget', title: 'budget', direction: 'gateway->runtime', domain: 'prompt', obligation: 'gated', capability: 'turnBudgetApi', verification: 'attested', implementation: 'prompt', consumer: 'test', impact: 'x' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/behavior.*behavior id/i);
    expect(errors.join('\n')).toMatch(/conformance.*scenario/i);
  });

  it('rejects a preset that references an unknown surface', () => {
    const errors = validateManifest(fixture({
      presets: [{ id: 'core', title: 'Core', description: '', requiredSurfaces: ['missing.surface'], capabilities: [] }],
    }));
    expect(errors.join('\n')).toMatch(/unknown surface/i);
  });

  it('builds a complete manifest object', () => {
    const m = buildRuntimeContractManifest();
    expect(m.schemaVersion).toBe(1);
    expect(m.contractVersion).toBe('2026.10.0');
    expect(m.generatedFrom).toBe('gateway/src/runtime/contract-manifest.ts');
  });
});
