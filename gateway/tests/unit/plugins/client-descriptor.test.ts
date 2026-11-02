import {
  buildClientDescriptor,
  buildClientSnapshot,
  type ClientDescriptorInput,
} from '../../../src/plugins/client-descriptor';
import type { ActivatedContributions } from '../../../src/plugins/package-types';

function activated(): ActivatedContributions {
  return {
    ui: { panels: [{ id: 'main', title: 'Main', viewAction: 'load' }] },
    actions: [
      { name: 'load', descriptor: { name: 'load', title: 'Load' }, declaration: { handler: () => null } },
      {
        name: 'save',
        descriptor: { name: 'save', outputSchema: { type: 'object' } },
        declaration: { handler: () => null },
      },
    ],
    events: [
      {
        descriptor: { type: 'plugin:acme:changed', scope: 'session', schema: { type: 'object' } },
        declaration: { type: 'plugin:acme:changed', scope: 'session' },
      },
    ],
    legacy: { usage: { name: 'acme', fetch: async () => null } },
  };
}

function input(overrides: Partial<ClientDescriptorInput> = {}): ClientDescriptorInput {
  return { name: 'acme', revision: 'boot-1:7', activated: activated(), ...overrides };
}

function collectFunctions(value: unknown, found: string[], pointer = '#'): void {
  if (typeof value === 'function') {
    found.push(pointer);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFunctions(item, found, `${pointer}/${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectFunctions(child, found, `${pointer}/${key}`);
  }
}

describe('buildClientDescriptor', () => {
  it('projects the declarative DTOs together with the revision', () => {
    const descriptor = buildClientDescriptor(input());
    expect(descriptor).toMatchObject({
      name: 'acme',
      version: '0.0.0',
      revision: 'boot-1:7',
    });
    expect(descriptor.ui.panels).toEqual([{ id: 'main', title: 'Main', viewAction: 'load' }]);
    expect(descriptor.actions.map((action) => action.name)).toEqual(['load', 'save']);
    expect(descriptor.events).toEqual([
      { type: 'plugin:acme:changed', scope: 'session', schema: { type: 'object' } },
    ]);
  });

  it('uses the manifest version when the host supplies one', () => {
    expect(buildClientDescriptor(input({ version: '1.2.3' })).version).toBe('1.2.3');
  });

  it('never exposes handlers, source or any other function', () => {
    const descriptor = buildClientDescriptor(input());
    const functions: string[] = [];
    collectFunctions(descriptor, functions);
    expect(functions).toEqual([]);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect((descriptor as any).legacy).toBeUndefined();
  });

  it('carries diagnostics only when the host provides some', () => {
    expect(buildClientDescriptor(input()).diagnostics).toBeUndefined();
    const descriptor = buildClientDescriptor(
      input({ diagnostics: [{ level: 'warning', message: 'pending revision', code: 'pending' }] }),
    );
    expect(descriptor.diagnostics).toEqual([{ level: 'warning', message: 'pending revision', code: 'pending' }]);
  });

  it('is immutable so a published snapshot cannot be mutated by consumers', () => {
    const descriptor = buildClientDescriptor(input());
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.actions)).toBe(true);
    expect(Object.isFrozen(descriptor.ui)).toBe(true);
    expect(() => {
      (descriptor.actions as any).push({ name: 'evil' });
    }).toThrow();
  });
});

describe('buildClientSnapshot', () => {
  it('sorts packages by name and keeps the revision', () => {
    const b = buildClientDescriptor(input({ name: 'beta' }));
    const a = buildClientDescriptor(input({ name: 'alpha' }));
    const snapshot = buildClientSnapshot('boot-1:9', [b, a]);
    expect(snapshot.revision).toBe('boot-1:9');
    expect(snapshot.plugins.map((plugin) => plugin.name)).toEqual(['alpha', 'beta']);
  });

  it('freezes the snapshot and its package list', () => {
    const snapshot = buildClientSnapshot('boot-1:9', [buildClientDescriptor(input())]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.plugins)).toBe(true);
    expect(() => {
      (snapshot as any).revision = 'tampered';
    }).toThrow();
  });

  it('is a plain serializable payload that survives a JSON round-trip', () => {
    const snapshot = buildClientSnapshot('boot-1:9', [buildClientDescriptor(input())]);
    const roundTrip = JSON.parse(JSON.stringify(snapshot));
    expect(roundTrip).toEqual({ revision: 'boot-1:9', plugins: snapshot.plugins });
    expect(roundTrip.plugins[0]).not.toHaveProperty('handler');
  });
});
