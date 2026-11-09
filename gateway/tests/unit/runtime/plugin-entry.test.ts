import { resolvePluginEntry } from '../../../src/runtime/plugin-entry';

it('recognizes a neutral definition', () => {
  const def = { api: 1, eventApi: 1, name: 'x', transport: {} };
  expect(resolvePluginEntry(def)).toEqual({ kind: 'neutral', definition: def });
});

it('recognizes an async createRuntimeDefinition factory', () => {
  const factory = async () => ({ api: 1, eventApi: 1, name: 'x', transport: {} });
  expect(resolvePluginEntry({ createRuntimeDefinition: factory }).kind).toBe('factory');
});

it('recognizes a legacy createRuntime export', () => {
  const legacy = { createRuntime: async () => ({}), capabilities: {} };
  expect(resolvePluginEntry(legacy).kind).toBe('legacy');
});
