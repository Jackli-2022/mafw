import { createRelayServer } from './server.ts';

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0 || value > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return value;
}

async function main(): Promise<void> {
  const domain = process.env.RELAY_DOMAIN;
  if (!domain) throw new Error('RELAY_DOMAIN is required (e.g. relay.example.com)');

  const relay = createRelayServer({
    domain,
    listenHost: process.env.RELAY_LISTEN_HOST ?? '0.0.0.0',
    tlsPort: port('RELAY_TLS_PORT', 443),
    controlPort: port('RELAY_CONTROL_PORT', 8444),
    adminPort: port('RELAY_ADMIN_PORT', 8080),
  });

  await relay.start();
  const ports = relay.ports();
  console.log(`[relay] domain=${domain} tls=${ports.tls} control=${ports.control} admin=${ports.admin}`);

  const shutdown = async () => {
    await relay.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`[relay] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
