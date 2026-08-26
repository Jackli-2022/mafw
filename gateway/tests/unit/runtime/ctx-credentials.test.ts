import { createRuntimePluginContext } from '../../../src/runtime/loader';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({ config: { raw: {} } }));

describe('createRuntimePluginContext credentials', () => {
  it('passes credentials through to ctx', () => {
    const ctx = createRuntimePluginContext({ getApiKey: (p: string) => p === 'xiaomi' ? 'KEY' : null });
    expect(ctx.credentials?.getApiKey('xiaomi')).toBe('KEY');
    expect(ctx.credentials?.getApiKey('openai')).toBeNull();
  });

  it('credentials undefined when not provided', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.credentials).toBeUndefined();
  });
});