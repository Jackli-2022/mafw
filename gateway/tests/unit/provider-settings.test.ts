import {
  readProviderApiKey,
  readProviderBaseUrl,
  readProviderBaseUrlWithPath,
  readProviderTransportFromList,
} from '../../src/runtime/provider-settings';

const v2 = {
  provider: {
    gateway: {
      name: '蓝区统一网关',
      package: 'aisdk:@ai-sdk/openai-compatible',
      settings: {
        apiKey: 'sk-gw',
        baseURL: 'https://gw.example.com/v1',
      },
    },
  },
};

const v1 = {
  provider: {
    gateway: {
      options: { apiKey: 'sk-old', baseURL: 'https://old.example.com/v1' },
    },
  },
};

describe('provider settings reader', () => {
  test('reads v2 `settings` block', () => {
    expect(readProviderBaseUrl(v2, 'gateway')).toBe('https://gw.example.com/v1');
    expect(readProviderApiKey(v2, 'gateway')).toBe('sk-gw');
  });

  test('still reads legacy `options` block', () => {
    expect(readProviderBaseUrl(v1, 'gateway')).toBe('https://old.example.com/v1');
    expect(readProviderApiKey(v1, 'gateway')).toBe('sk-old');
  });

  test('settings wins over options when both exist', () => {
    const both = {
      provider: { gateway: { settings: { baseURL: 'https://new/v1' }, options: { baseURL: 'https://old/v1' } } },
    };
    expect(readProviderBaseUrl(both, 'gateway')).toBe('https://new/v1');
  });

  test('missing provider or non-string values → null', () => {
    expect(readProviderBaseUrl(v2, 'nope')).toBeNull();
    expect(readProviderApiKey(v2, 'nope')).toBeNull();
    expect(readProviderBaseUrl({ provider: { x: { settings: { baseURL: 42 } } } }, 'x')).toBeNull();
    expect(readProviderBaseUrl(undefined, 'gateway')).toBeNull();
  });

  test('chat-completions path is appended exactly once', () => {
    expect(readProviderBaseUrlWithPath(v2, 'gateway')).toBe('https://gw.example.com/v1/chat/completions');
    const trailing = { provider: { x: { settings: { baseURL: 'https://h/v1/' } } } };
    expect(readProviderBaseUrlWithPath(trailing, 'x')).toBe('https://h/v1/chat/completions');
    const already = { provider: { x: { settings: { baseURL: 'https://h/v1/chat/completions' } } } };
    expect(readProviderBaseUrlWithPath(already, 'x')).toBe('https://h/v1/chat/completions');
  });

  test('reads transport from the provider registry list (fallback source)', () => {
    const list = {
      all: [
        { id: 'other', settings: { baseURL: 'https://o/v1' } },
        { id: 'gateway', settings: { apiKey: 'sk-list', baseURL: 'https://gw/v1' } },
      ],
    };
    expect(readProviderTransportFromList(list, 'gateway')).toEqual({
      baseUrl: 'https://gw/v1/chat/completions',
      apiKey: 'sk-list',
    });
    expect(readProviderTransportFromList(list, 'missing')).toEqual({ baseUrl: null, apiKey: null });
    expect(readProviderTransportFromList(null, 'gateway')).toEqual({ baseUrl: null, apiKey: null });
  });
});
