import { loadOrCreateRelayIdentity, type RelayIdentity } from './relay-identity';
import { RelayTunnelClient, type RelayTunnelStatus } from './relay-tunnel-client';
import { createTunnelTerminator, type TunnelTerminator } from './tunnel-terminator';

export interface RelayServiceOptions {
  enabled: boolean;
  domain: string;
  controlUrl: string;
  dataDir: string;
  targetPort: number;
  tunnelSecret: string;
  /** Default 3002; 0 picks an ephemeral port (tests). */
  localPort?: number;
}

export interface RelayServiceStatus {
  enabled: boolean;
  connected: boolean;
  roomUrl?: string;
  fingerprint?: string;
  lastError?: string;
}

export interface RelayService {
  start(): Promise<RelayServiceStatus>;
  stop(): Promise<void>;
  status(): RelayServiceStatus;
  terminatorPort(): number;
}

export function createRelayService(opts: RelayServiceOptions): RelayService {
  let identity: RelayIdentity | null = null;
  let terminator: TunnelTerminator | null = null;
  let client: RelayTunnelClient | null = null;
  let started = false;

  const status = (): RelayServiceStatus => {
    if (!opts.enabled) return { enabled: false, connected: false };
    const connection: RelayTunnelStatus = client?.status() ?? { connected: false };
    return {
      enabled: true,
      connected: connection.connected,
      roomUrl: identity?.roomUrl,
      fingerprint: identity?.fingerprint,
      lastError: connection.lastError,
    };
  };

  return {
    async start(): Promise<RelayServiceStatus> {
      if (!opts.enabled) return status();
      if (started) return status();
      if (!opts.domain || !opts.controlUrl) {
        throw new Error('relay requires roomDomain and control url');
      }

      identity = loadOrCreateRelayIdentity(opts.dataDir, { domain: opts.domain });
      terminator = createTunnelTerminator({
        secret: opts.tunnelSecret,
        targetPort: opts.targetPort,
        listenPort: opts.localPort ?? 3002,
        fallbackToEphemeral: true,
        tls: { key: identity.keyPem, cert: identity.certPem },
      });
      const localPort = await terminator.start();
      client = new RelayTunnelClient({
        url: opts.controlUrl,
        roomId: identity.roomId,
        roomToken: identity.roomToken,
        routeSecret: identity.routeSecret,
        localPort,
      });
      client.start();
      started = true;
      return status();
    },

    async stop(): Promise<void> {
      started = false;
      client?.stop();
      client = null;
      await terminator?.stop();
      terminator = null;
    },

    status,

    terminatorPort(): number {
      const port = terminator?.port();
      if (port === null || port === undefined) throw new Error('relay terminator is not running');
      return port;
    },
  };
}
