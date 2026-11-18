/**
 * Client channel — where a chat turn came from (desktop / mobile / TUI / web /
 * API). The reminder part carries it for clients that compose their own user
 * metadata; the gateway stamps it for clients that do not (mobile WS/HTTP).
 *
 * It is context, not a memory fact: the value only rides the current prompt as
 * a synthetic text part and never reaches the memory store.
 */

export const CLIENT_CHANNEL_HEADER = 'x-mafw-client';
export const CLIENT_CHANNEL_TAG = 'client-channel';

export type ClientChannel = 'desktop' | 'mobile' | 'tui' | 'web' | 'api' | 'unknown';

const ALIASES: Record<string, ClientChannel> = {
  desktop: 'desktop',
  electron: 'desktop',
  app: 'desktop',
  mobile: 'mobile',
  phone: 'mobile',
  ios: 'mobile',
  android: 'mobile',
  tui: 'tui',
  cli: 'tui',
  terminal: 'tui',
  web: 'web',
  browser: 'web',
  api: 'api',
  sdk: 'api',
};

const LABELS: Record<Exclude<ClientChannel, 'unknown'>, string> = {
  desktop: '桌面端',
  mobile: '手机端',
  tui: '终端',
  web: '网页',
  api: 'API',
};

export function normalizeClientChannel(value: unknown): ClientChannel {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!key) return 'unknown';
  return ALIASES[key] ?? 'unknown';
}

export function clientChannelLabel(channel: ClientChannel): string {
  return channel === 'unknown' ? '未知客户端' : LABELS[channel];
}

export interface ClientChannelPart {
  type: 'text';
  id: string;
  text: string;
  synthetic: true;
}

function clientChannelPart(channel: ClientChannel, now: number): ClientChannelPart | null {
  if (channel === 'unknown') return null;
  return {
    type: 'text',
    id: `prt_client_channel_${now}`,
    text: `<${CLIENT_CHANNEL_TAG}>${clientChannelLabel(channel)}</${CLIENT_CHANNEL_TAG}>`,
    synthetic: true,
  };
}

const REMINDER_WITH_CHANNEL = /<latest-reminder>[^<]*渠道：/;

/**
 * Append the channel part unless the request already carries it (a modern
 * `<latest-reminder>` with `渠道：`) or an identical channel block. A legacy
 * reminder without a channel still gets the extra part.
 */
export function withClientChannel(
  parts: unknown,
  message: unknown,
  channel: ClientChannel,
  now: number = Date.now(),
): any[] {
  const list = Array.isArray(parts) ? parts : [];
  const part = clientChannelPart(channel, now);
  if (!part) return list;
  const texts = [
    typeof message === 'string' ? message : '',
    ...list.map((item: any) => (typeof item?.text === 'string' ? item.text : '')),
  ];
  if (texts.some((text) => text.includes(`<${CLIENT_CHANNEL_TAG}>`) || REMINDER_WITH_CHANNEL.test(text))) {
    return list;
  }
  return [...list, part];
}
