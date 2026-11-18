import {
  CLIENT_CHANNEL_HEADER,
  clientChannelLabel,
  normalizeClientChannel,
  withClientChannel,
} from '../../../src/runtime/client-channel';

describe('client channel', () => {
  it('normalizes headers and common aliases', () => {
    expect(CLIENT_CHANNEL_HEADER).toBe('x-mafw-client');
    expect(normalizeClientChannel('Desktop')).toBe('desktop');
    expect(normalizeClientChannel('electron')).toBe('desktop');
    expect(normalizeClientChannel('ios')).toBe('mobile');
    expect(normalizeClientChannel('Android')).toBe('mobile');
    expect(normalizeClientChannel('cli')).toBe('tui');
    expect(normalizeClientChannel('browser')).toBe('web');
    expect(normalizeClientChannel('sdk')).toBe('api');
    expect(normalizeClientChannel(undefined)).toBe('unknown');
    expect(normalizeClientChannel('weird')).toBe('unknown');
  });

  it('labels channels in plain words', () => {
    expect(clientChannelLabel('desktop')).toBe('桌面端');
    expect(clientChannelLabel('mobile')).toBe('手机端');
    expect(clientChannelLabel('tui')).toBe('终端');
    expect(clientChannelLabel('web')).toBe('网页');
    expect(clientChannelLabel('api')).toBe('API');
  });

  it('appends a hidden channel part for a recognized client', () => {
    const parts = withClientChannel(undefined, 'hello', 'mobile');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text', synthetic: true });
    expect(parts[0].text).toBe('<client-channel>手机端</client-channel>');
  });

  it('does not duplicate a reminder that already carries the channel', () => {
    const reminder = {
      type: 'text',
      text: '<latest-reminder>2026-11-18 周三 14:32 · 中文 · 渠道：桌面端</latest-reminder>',
      synthetic: true,
    };
    expect(withClientChannel([reminder], 'hello', 'desktop')).toEqual([reminder]);
  });

  it('still stamps a legacy reminder that has no channel', () => {
    const legacy = {
      type: 'text',
      text: '<latest-reminder>2026-11-18 周三 14:32 · 中文</latest-reminder>',
      synthetic: true,
    };
    const parts = withClientChannel([legacy], 'hello', 'desktop');
    expect(parts).toHaveLength(2);
    expect(parts[1].text).toBe('<client-channel>桌面端</client-channel>');
  });

  it('is idempotent and no-ops for unknown clients', () => {
    const first = withClientChannel(undefined, 'hello', 'tui');
    expect(withClientChannel(first, 'hello', 'tui')).toEqual(first);
    expect(withClientChannel([], 'hello', 'unknown')).toEqual([]);
  });
});
