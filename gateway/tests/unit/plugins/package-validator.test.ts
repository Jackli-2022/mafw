import { config } from '../../../src/config';
import {
  buildActivatedContributions,
  validateUnifiedContributions,
  type UnifiedPluginContributions,
} from '../../../src/plugins/package-validator';
import { createPluginPackageContext } from '../../../src/plugins/package-context';

const CANONICAL = new Set(['turn.completed', 'part.updated', 'permission.asked']);

function validContributions(): UnifiedPluginContributions {
  return {
    events: [
      {
        type: 'plugin:example:changed',
        title: 'Changed',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
        scope: 'session',
      },
    ],
    actions: {
      load: {
        handler: async () => ({ ok: true }),
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      },
      save: {
        handler: (input) => input,
        outputSchema: { type: 'object' },
      },
      'open-panel': { handler: () => null },
    },
    ui: {
      panels: [{ id: 'main', title: 'Main', viewAction: 'load', refreshOn: ['plugin:example:changed'] }],
      toolCards: [{ id: 'card', tools: ['mafw_search_hybrid'], viewAction: 'load' }],
      configPages: [
        {
          id: 'settings',
          title: 'Settings',
          schema: {
            type: 'object',
            properties: {
              apiKey: { type: 'string', minLength: 1 },
              limit: { type: 'integer', minimum: 1, maximum: 10 },
              mode: { type: 'string', enum: ['fast', 'full'], default: 'fast' },
              enabled: { type: 'boolean', default: true },
            },
            required: ['apiKey'],
            additionalProperties: false,
          },
          loadAction: 'load',
          saveAction: 'save',
        },
      ],
      messageWindows: [
        {
          id: 'changed-window',
          title: 'Changed',
          triggerEvent: 'plugin:example:changed',
          viewAction: 'load',
        },
      ],
    },
  };
}

describe('validateUnifiedContributions', () => {
  it('accepts a contribution set whose actions, events and UI reference each other', () => {
    expect(validateUnifiedContributions('example', validContributions(), CANONICAL)).toEqual([]);
  });

  it('returns diagnostics instead of throwing on a malformed contribution object', () => {
    const errors = validateUnifiedContributions(
      'example',
      { events: 'nope', actions: [], ui: 'nope' } as unknown as UnifiedPluginContributions,
      CANONICAL,
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.join('\n')).toMatch(/events must be an array/);
    expect(errors.join('\n')).toMatch(/actions must be an object/);
    expect(errors.join('\n')).toMatch(/ui must be an object/);
  });

  it('never throws on null, circular or unserializable input', () => {
    expect(validateUnifiedContributions('example', null as any, CANONICAL)).toEqual([
      'contributions must be an object',
    ]);

    const circularSchema: Record<string, unknown> = { type: 'object' };
    circularSchema.self = circularSchema;
    const circularUi: Record<string, unknown> = {};
    circularUi.self = circularUi;
    const errors = validateUnifiedContributions(
      'example',
      {
        actions: { load: { handler: () => null, inputSchema: circularSchema } },
        ui: circularUi,
      } as unknown as UnifiedPluginContributions,
      CANONICAL,
    );
    expect(errors.join('\n')).toMatch(/must be JSON-serializable/);
    expect(errors.join('\n')).toMatch(/unknown ui slot "self"/);
  });

  it('accepts a pure Host contribution set with no declarative contributions', () => {
    const usage = { name: 'example', type: 'api', async fetch() { return { windows: [] }; } };
    const contributions = { usage } as UnifiedPluginContributions;
    expect(validateUnifiedContributions('example', contributions, CANONICAL)).toEqual([]);

    const built = buildActivatedContributions('example', contributions, CANONICAL);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.ui).toEqual({});
    expect(built.value.actions).toEqual([]);
    expect(built.value.events).toEqual([]);
    expect(built.value.legacy.usage).toBe(usage);
  });

  it('rejects canonical runtime event names', () => {
    const contributions = validContributions();
    contributions.events = [{ type: 'turn.completed' } as any];
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/canonical/i);
  });

  it('rejects another package namespace', () => {
    const contributions = validContributions();
    contributions.events = [{ type: 'plugin:other:changed' }];
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/another package/);
  });

  it('rejects event names outside plugin:<package>:*', () => {
    const contributions = validContributions();
    contributions.events = [{ type: 'example:changed' }];
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/plugin:<package>:/);
  });

  it('rejects duplicate and empty event names', () => {
    const contributions = validContributions();
    contributions.events = [
      { type: 'plugin:example:changed' },
      { type: 'plugin:example:changed' },
      { type: 'plugin:example:' },
    ];
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/duplicate event type/);
    expect(errors.join('\n')).toMatch(/non-empty event name/);
  });

  it('rejects a malformed action handler', () => {
    const contributions = validContributions();
    contributions.actions = {
      broken: { handler: 'not-a-function' } as any,
      missing: {} as any,
    };
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/handler must be a function/);
    expect(errors.filter((error) => /handler must be a function/.test(error))).toHaveLength(2);
  });

  it('rejects cross-package action names and unknown declaration fields', () => {
    const contributions = validContributions();
    contributions.actions = {
      'other:action': { handler: () => null },
      typed: { handler: () => null, unknownField: true } as any,
    };
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/must not contain ":"/);
    expect(errors.join('\n')).toMatch(/unknown field "unknownField"/);
  });

  it('rejects action timeouts outside the configured bounds', () => {
    const contributions = validContributions();
    contributions.actions = {
      slow: { handler: () => null, timeoutMs: 120_000 },
      fractional: { handler: () => null, timeoutMs: 1.5 },
      zero: { handler: () => null, timeoutMs: 0 },
    };
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/timeoutMs must be a positive integer/);
    expect(errors.join('\n')).toMatch(/exceeds the maximum/);
  });

  it('rejects UI references to actions that are not declared', () => {
    const contributions = validContributions();
    contributions.ui = { panels: [{ id: 'main', title: 'Main', viewAction: 'missing' }] };
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/unknown action reference "missing"/);
  });

  it('rejects UI references to events that are not declared', () => {
    const contributions = validContributions();
    contributions.ui = {
      panels: [{ id: 'main', title: 'Main', viewAction: 'load', refreshOn: ['plugin:example:other'] }],
    };
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/unknown event reference "plugin:example:other"/);
  });

  it('rejects UI references to another package namespace', () => {
    const contributions = validContributions();
    contributions.ui = {
      messageWindows: [
        {
          id: 'win',
          title: 'Win',
          triggerEvent: 'plugin:other:changed',
          viewAction: 'load',
        },
      ],
    };
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/cross-package event reference/);
  });

  it('accepts the restricted config form subset', () => {
    const contributions = validContributions();
    expect(validateUnifiedContributions('example', contributions, CANONICAL)).toEqual([]);
  });

  it('rejects config page schemas outside the restricted subset', () => {
    const contributions = validContributions();
    contributions.ui = {
      configPages: [
        {
          id: 'settings',
          title: 'Settings',
          schema: {
            type: 'object',
            properties: {
              nested: { type: 'object', properties: { a: { type: 'string' } } },
            },
          } as any,
          loadAction: 'load',
          saveAction: 'save',
        },
      ],
    };
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/unsupported config field kind "object"/);
  });

  it('rejects remote $ref in action schemas but accepts local $defs', () => {
    const local = validContributions();
    local.actions = {
      load: {
        handler: () => null,
        inputSchema: {
          type: 'object',
          $defs: { text: { type: 'string' } },
          properties: { name: { $ref: '#/$defs/text' } },
        },
      },
    };
    local.ui = {};
    expect(validateUnifiedContributions('example', local, CANONICAL)).toEqual([]);

    const remote = validContributions();
    remote.actions = {
      load: {
        handler: () => null,
        inputSchema: {
          type: 'object',
          properties: { name: { $ref: 'https://example.com/schema.json#/name' } },
        },
      },
    };
    remote.ui = {};
    const errors = validateUnifiedContributions('example', remote, CANONICAL);
    expect(errors.join('\n')).toMatch(/remote \$ref/);
  });

  it('rejects non-2020-12 $schema declarations', () => {
    const contributions = validContributions();
    contributions.actions = {
      load: {
        handler: () => null,
        inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' },
      },
    };
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/2020-12/);
  });

  it('rejects oversized action schemas', () => {
    const contributions = validContributions();
    contributions.actions = {
      load: {
        handler: () => null,
        inputSchema: { type: 'object', description: 'x'.repeat(300 * 1024) },
      },
    };
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/exceeds/);
  });

  it('reconciles the spec payloadSchema name into the descriptor schema field', () => {
    const contributions = validContributions();
    contributions.events = [
      { type: 'plugin:example:changed', payloadSchema: { type: 'object' } } as any,
    ];
    contributions.ui = {};
    expect(validateUnifiedContributions('example', contributions, CANONICAL)).toEqual([]);
  });

  it('rejects declaring both schema and payloadSchema for one event', () => {
    const contributions = validContributions();
    contributions.events = [
      {
        type: 'plugin:example:changed',
        schema: { type: 'object' },
        payloadSchema: { type: 'object' },
      } as any,
    ];
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/schema and payloadSchema/);
  });
});

describe('buildActivatedContributions', () => {
  it('separates client descriptors from host declarations', () => {
    const result = buildActivatedContributions('example', validContributions(), CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { ui, actions, events } = result.value;
    expect(ui.panels?.[0]).toMatchObject({ id: 'main', viewAction: 'load' });
    expect(JSON.stringify(ui)).not.toMatch(/handler/);

    const load = actions.find((action) => action.name === 'load');
    expect(load?.descriptor).toEqual({
      name: 'load',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    });
    expect(typeof load?.declaration.handler).toBe('function');
    expect(JSON.stringify(load?.descriptor)).not.toMatch(/handler/);

    expect(events.map((event) => event.descriptor.type)).toEqual(['plugin:example:changed']);
    expect(events[0].descriptor.schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect(events[0].declaration).toMatchObject({ type: 'plugin:example:changed' });
  });

  it('carries the declared event scope into the client descriptor', () => {
    const result = buildActivatedContributions('example', validContributions(), CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.events[0].declaration.scope).toBe('session');
    expect(result.value.events[0].descriptor.scope).toBe('session');
    // The descriptor must stay serializable: scope is plain data, not Host state.
    expect(JSON.parse(JSON.stringify(result.value.events[0].descriptor)).scope).toBe('session');
  });

  it('leaves scope absent from the descriptor when it is not declared', () => {
    const contributions = validContributions();
    delete contributions.events![0].scope;
    const result = buildActivatedContributions('example', contributions, CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('scope' in result.value.events[0].descriptor).toBe(false);
  });

  it('rejects an invalid event scope', () => {
    const contributions = validContributions();
    contributions.events = [
      { type: 'plugin:example:changed', scope: 'forever' } as any,
    ];
    contributions.ui = {};
    const errors = validateUnifiedContributions('example', contributions, CANONICAL);
    expect(errors.join('\n')).toMatch(/scope must be "global" or "session"/);
    // Exactly one diagnostic: the contract must not repeat the Host's finding.
    expect(errors.filter((error) => /scope must be/.test(error))).toHaveLength(1);
  });

  it('carries legacy contributions through untouched', () => {
    const usage = { name: 'example', type: 'api', async fetch() { return { windows: [] }; } };
    const result = buildActivatedContributions(
      'example',
      { ...validContributions(), usage },
      CANONICAL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legacy.usage).toBe(usage);
    expect(result.value.legacy.runtime).toBeUndefined();
  });

  it('fails closed with diagnostics when validation fails', () => {
    const result = buildActivatedContributions(
      'example',
      { events: [{ type: 'plugin:other:changed' }] },
      CANONICAL,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/another package/);
  });
});

describe('ctx.config.update', () => {
  const savedData = (config as any).data;
  afterEach(() => { (config as any).data = savedData; });

  function makeCtx(persistCalls: Array<Record<string, unknown>>) {
    return createPluginPackageContext('example', {
      projectDir: '/p',
      gatewayPort: 3000,
      persistConfig: (overrides) => {
        persistCalls.push(overrides);
        // Simulate persistOverrides' deep merge into the live config.
        (config as any).data = {
          ...(config as any).data,
          plugins: { ...(config as any).data?.plugins, ...(overrides as any).plugins },
        };
      },
    });
  }

  it('merges the patch under plugins.<package>.config only', () => {
    (config as any).data = {};
    const calls: Array<Record<string, unknown>> = [];
    const ctx = makeCtx(calls);

    ctx.config.update({ limit: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ plugins: { example: { config: { limit: 5 } } } });
    expect(Object.keys(calls[0])).toEqual(['plugins']);
    expect((config.raw as any).server).toBeUndefined();
  });

  it('keeps existing package config keys when patching', () => {
    (config as any).data = { plugins: { example: { config: { apiKey: 'old', limit: 1 } } } };
    const calls: Array<Record<string, unknown>> = [];
    const ctx = makeCtx(calls);

    ctx.config.update({ limit: 5 });

    expect(ctx.pluginConfig()).toEqual({ apiKey: 'old', limit: 5 });
  });

  it('reads pluginConfig fresh on every call', () => {
    (config as any).data = { plugins: { example: { config: { limit: 1 } } } };
    const ctx = createPluginPackageContext('example', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({ limit: 1 });

    (config as any).data = { plugins: { example: { config: { limit: 2 } } } };
    expect(ctx.pluginConfig()).toEqual({ limit: 2 });
  });

  it('cannot escape its own namespace through nested plugins keys', () => {
    (config as any).data = { plugins: { other: { config: { keep: true } } } };
    const calls: Array<Record<string, unknown>> = [];
    const ctx = makeCtx(calls);

    ctx.config.update({ plugins: { other: { config: { hacked: true } } } });

    expect(calls[0]).toEqual({
      plugins: { example: { config: { plugins: { other: { config: { hacked: true } } } } } },
    });
    expect((config.raw as any).plugins.other).toEqual({ config: { keep: true } });
  });

  it('rejects a non-object patch without persisting', () => {
    (config as any).data = {};
    const calls: Array<Record<string, unknown>> = [];
    const ctx = makeCtx(calls);

    expect(() => ctx.config.update(null as any)).toThrow(TypeError);
    expect(() => ctx.config.update([1, 2] as any)).toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('rejects prototype-polluting patch keys', () => {
    (config as any).data = {};
    const calls: Array<Record<string, unknown>> = [];
    const ctx = makeCtx(calls);
    const patch = JSON.parse('{"__proto__":{"polluted":true}}');

    expect(() => ctx.config.update(patch)).toThrow(TypeError);
    expect(calls).toHaveLength(0);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('rejects unserializable patch values without persisting', () => {
    (config as any).data = {};
    const calls: Array<Record<string, unknown>> = [];
    const ctx = makeCtx(calls);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => ctx.config.update(circular)).toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});
