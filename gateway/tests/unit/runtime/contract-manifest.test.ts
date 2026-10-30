import {
  buildRuntimeContractManifest,
  validateManifest,
  type RuntimeContractManifest,
} from '../../../src/runtime/contract-manifest';
import { CORE_SURFACES } from '../../../src/runtime/contract-surfaces-core';
import { AGENT_SURFACES } from '../../../src/runtime/contract-surfaces-agent';

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

function surface(id: string) {
  return buildRuntimeContractManifest().surfaces.find((s) => s.id === id);
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

describe('core surfaces', () => {
  it('covers loader metadata as declaration/plugin probes', () => {
    expect(surface('plugin.name')).toMatchObject({ obligation: 'required', verification: 'presence', probe: ['plugin', 'name'] });
    expect(surface('plugin.createRuntime')).toMatchObject({ obligation: 'required', probe: ['plugin', 'createRuntime'] });
    expect(surface('plugin.eventMappings')).toMatchObject({ obligation: 'gated', capability: 'eventStream', probe: ['declaration', 'eventMappings'] });
  });

  it('covers the 11 required session methods', () => {
    for (const id of ['session.create', 'session.promptAsync', 'session.prompt', 'session.messages', 'session.get', 'session.delete', 'session.abort', 'session.list', 'session.todo', 'session.children', 'session.summarize']) {
      expect(surface(id)).toMatchObject({ obligation: 'required', verification: 'presence' });
    }
  });

  it('marks rename optional and branch surfaces gated', () => {
    expect(surface('session.update')).toMatchObject({ obligation: 'optional', probe: ['session', 'update'] });
    expect(surface('branch.fork')).toMatchObject({ obligation: 'gated', capability: 'sessionBranchApi' });
    expect(surface('branch.checkpoint')).toMatchObject({ obligation: 'gated', capability: 'checkpointApi', verification: 'attested' });
  });

  it('marks provider methods conditionally required', () => {
    expect(surface('provider.list')).toMatchObject({
      obligation: 'required',
      requiredWhen: { capabilities: ['providerConfigApi'] },
    });
    expect(surface('provider.config')).toMatchObject({ obligation: 'required', requiredWhen: { capabilities: ['providerConfigApi'] } });
  });

  it('marks health/base-url advisory and process restart gated', () => {
    expect(surface('process.healthCheck')).toMatchObject({ obligation: 'advisory' });
    expect(surface('process.restart')).toMatchObject({ obligation: 'gated', capability: 'agentProcessApi' });
  });

  it('exposes CORE_SURFACES without duplicate ids', () => {
    const ids = CORE_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('agent surfaces', () => {
  it('covers prompt inputs and separates presence from behavior', () => {
    expect(surface('prompt.parts.text')).toMatchObject({ obligation: 'required', verification: 'presence' });
    expect(surface('prompt.parts.file')).toMatchObject({ obligation: 'optional', verification: 'behavior' });
    expect(surface('prompt.result.usage')).toMatchObject({ obligation: 'optional', verification: 'behavior' });
  });

  it('covers event surfaces with presets', () => {
    expect(surface('events.global')).toMatchObject({ obligation: 'required', requiredWhen: { capabilities: ['eventStream'] } });
    expect(surface('events.turn.terminal')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['conversation']) });
    expect(surface('events.part.tool')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['desktop']) });
  });

  it('covers tools and approvals', () => {
    expect(surface('tools.registerTools')).toMatchObject({ obligation: 'required', verification: 'presence' });
    expect(surface('tools.nativeTools')).toMatchObject({ obligation: 'required', verification: 'presence' });
    expect(surface('approval.permissionReply')).toMatchObject({ obligation: 'gated', capability: 'nativeApprovals' });
    expect(surface('approval.permissionList')).toMatchObject({ obligation: 'gated', capability: 'nativeApprovals' });
  });

  it('covers identity/discovery/mcp/cognition/media/usage', () => {
    expect(surface('identity.agents.install')).toMatchObject({ obligation: 'gated', capability: 'agentConfigApi' });
    expect(surface('discovery.list')).toMatchObject({ obligation: 'gated', capability: 'discoveryApi' });
    expect(surface('mcp.list')).toMatchObject({ obligation: 'gated', capability: 'mcpApi' });
    expect(surface('cognition.observe')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['conversation']) });
    expect(surface('media.tools')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['desktop']) });
    expect(surface('usage.event')).toMatchObject({ obligation: 'optional' });
  });

  it('exposes AGENT_SURFACES without duplicate ids', () => {
    const ids = AGENT_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
