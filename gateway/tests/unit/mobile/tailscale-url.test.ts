/**
 * P0-3: 移动配对 URL 解析优先级 — env > config > 自动探测。
 * env: MAFW_MOBILE_TAILSCALE_URL；config: mobile.tailscaleUrl；
 * 回落 detectReachableHost() 的 host:port。值会去尾斜杠。
 */
import { resolveMobileBaseUrl } from '../../../src/mobile/tailscale-url';

describe('resolveMobileBaseUrl (P0-3)', () => {
  it('env wins over config and detected host', () => {
    expect(resolveMobileBaseUrl('https://env.tailnet.ts.net', 'https://cfg.tailnet.ts.net', '100.1.2.3', 3000))
      .toBe('https://env.tailnet.ts.net');
  });

  it('config is used when env is empty', () => {
    expect(resolveMobileBaseUrl('', 'http://cfg.tailnet.ts.net:3000', '100.1.2.3', 3000))
      .toBe('http://cfg.tailnet.ts.net:3000');
  });

  it('falls back to detected host:port', () => {
    expect(resolveMobileBaseUrl(undefined, undefined, '100.1.2.3', 3000))
      .toBe('http://100.1.2.3:3000');
  });

  it('normalizes trailing slashes', () => {
    expect(resolveMobileBaseUrl('https://env.tailnet.ts.net/', '', '100.1.2.3', 3000))
      .toBe('https://env.tailnet.ts.net');
  });
});
