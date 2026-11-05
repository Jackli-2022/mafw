/**
 * P0-3: 移动配对 URL 解析。
 *
 * 优先级：env（MAFW_MOBILE_TAILSCALE_URL）> config（mobile.tailscaleUrl）>
 * 自动探测（detectReachableHost()，Tailscale 网卡优先）回落的 host:port。
 * 空串视为未配置；结果去尾斜杠（配对码拼 query 时避免双斜杠）。
 *
 * 详见 docs/superpowers/plans/2026-11-05-mobile-gateway-p0.md Task 3。
 */
import * as os from 'os';

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveMobileBaseUrl(
  env: string | undefined,
  configUrl: string | undefined,
  detectedHost: string,
  port: number,
): string {
  const fromEnv = normalizeBaseUrl(env || '');
  if (fromEnv) return fromEnv;
  const fromConfig = normalizeBaseUrl(configUrl || '');
  if (fromConfig) return fromConfig;
  return `http://${detectedHost}:${port}`;
}

/**
 * 自动探测本机可达 IPv4：Tailscale 网卡 > LAN（wlan/eth）> 首个非环回。
 * `http://localhost` 对手机无意义（手机会连自己），所以绝不返回 localhost。
 */
export function detectReachableHost(): string {
  const ifaces = os.networkInterfaces();
  let lan: string | null = null;
  let tailscale: string | null = null;
  let anyV4: string | null = null;
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (name.toLowerCase().startsWith('tailscale') || name === 'utun') tailscale = a.address;
      else if (!anyV4) anyV4 = a.address;
      if (!lan && (name.toLowerCase().includes('wlan') || name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('ethernet') || name.toLowerCase().includes('eth'))) lan = a.address;
    }
  }
  return tailscale || lan || anyV4 || '127.0.0.1';
}
