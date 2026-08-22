/**
 * mDNS/DNS-SD advertiser for the MAFW Gateway.
 *
 * Broadcasts `_mafw._tcp` service so mobile apps can auto-discover the gateway
 * on the local network (zero-config LAN connectivity, spec §5.1 P1).
 *
 * TXT records carry metadata:
 *   - version: API version (e.g., "1.0")
 *   - port: HTTP port
 *   - ws: WebSocket path (/api/ws)
 *   - auth: "token" if apiToken required, "open" otherwise
 */

import { Bonjour, Service } from 'bonjour-service';

interface MdnsConfig {
  apiPort: number;
  apiToken: string;
  instanceName?: string; // defaults to hostname
}

export class MdnsAdvertiser {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;

  start(config: MdnsConfig): void {
    const instanceName = config.instanceName || require('os').hostname();
    const txt: Record<string, string> = {
      version: '1.0',
      port: String(config.apiPort),
      ws: '/api/ws',
      auth: config.apiToken ? 'token' : 'open',
    };

    try {
      this.bonjour = new Bonjour();
      this.service = this.bonjour.publish({
        name: `MAFW ${instanceName}`,
        type: 'mafw',
        port: config.apiPort,
        txt,
      });
      console.log(`[mDNS] advertising _mafw._tcp on port ${config.apiPort} (instance: ${instanceName})`);
    } catch (err) {
      console.warn('[mDNS] failed to start:', err);
    }
  }

  stop(): void {
    if (this.service) {
      this.service.stop(() => {
        console.log('[mDNS] stopped');
      });
      this.service = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }
}
