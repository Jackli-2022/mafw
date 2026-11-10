/**
 * Judge/scan provider transport precedence (Task 6 review fix).
 *
 * Old order was runtime credentials (auth.json) → gateway config → provider
 * list. The adapter seam must not jump ahead of credentials: a stale inline
 * `opencode.jsonc` key must never beat the authoritative auth.json key.
 */
import { resolveProviderTransportPrecedence } from '../../../src/runtime/provider-transport';

describe('resolveProviderTransportPrecedence', () => {
  it('credentials win over the driver inline key', async () => {
    const fallback = jest.fn(async () => ({}));
    const result = await resolveProviderTransportPrecedence({
      providerID: 'qwen',
      credentials: { getApiKey: () => 'sk-auth' },
      resolveTransport: async () => ({ baseUrl: 'https://inline.example/v1', apiKey: 'sk-inline' }),
      fallback,
    });
    expect(result).toEqual({ baseUrl: 'https://inline.example/v1', apiKey: 'sk-auth' });
    // Transport supplied both fields → no duplicate config read.
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the driver transport key when credentials are absent', async () => {
    const fallback = jest.fn(async () => ({}));
    const result = await resolveProviderTransportPrecedence({
      providerID: 'qwen',
      resolveTransport: async () => ({ baseUrl: 'https://inline.example/v1', apiKey: 'sk-inline' }),
      fallback,
    });
    expect(result).toEqual({ baseUrl: 'https://inline.example/v1', apiKey: 'sk-inline' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('asks the fallback only for fields the transport could not resolve', async () => {
    const fallback = jest.fn(async () => ({ baseUrl: 'https://cfg.example/v1', apiKey: 'sk-cfg' }));
    const result = await resolveProviderTransportPrecedence({
      providerID: 'qwen',
      credentials: { getApiKey: () => null },
      resolveTransport: async () => ({ baseUrl: 'https://inline.example/v1' }),
      fallback,
    });
    expect(fallback).toHaveBeenCalledWith({ needBaseUrl: false, needApiKey: true });
    expect(result).toEqual({ baseUrl: 'https://inline.example/v1', apiKey: 'sk-cfg' });
  });

  it('falls back for both fields when the driver seam is absent', async () => {
    const result = await resolveProviderTransportPrecedence({
      providerID: 'qwen',
      credentials: { getApiKey: () => null },
      fallback: async () => ({ baseUrl: 'https://cfg.example/v1', apiKey: 'sk-cfg' }),
    });
    expect(result).toEqual({ baseUrl: 'https://cfg.example/v1', apiKey: 'sk-cfg' });
  });

  it('fail-opens credential/transport errors to the fallback chain', async () => {
    const result = await resolveProviderTransportPrecedence({
      providerID: 'qwen',
      credentials: { getApiKey: () => { throw new Error('auth down'); } },
      resolveTransport: async () => { throw new Error('driver down'); },
      fallback: async () => ({ baseUrl: 'https://cfg.example/v1', apiKey: 'sk-cfg' }),
    });
    expect(result).toEqual({ baseUrl: 'https://cfg.example/v1', apiKey: 'sk-cfg' });
  });
});
