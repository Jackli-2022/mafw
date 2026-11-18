/**
 * M0: the pairing-code loopback exemption must be a `local` principal
 * decision. A relayed caller reaches the gateway over a loopback socket, so
 * IP-based exemption would let it mint codes without a limit.
 */
import { PairingService } from '../../../src/mobile/pairing';

describe('pairing-code rate limit (M0)', () => {
  let service: PairingService;

  afterEach(() => {
    service?.destroy();
  });

  it('rate-limits a relayed caller even though the socket is loopback', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', rateLimit: 1 });
    const generate = service.generatePairingCode.bind(service) as (ip: string, opts?: { local?: boolean }) => { url: string };

    expect(() => generate('127.0.0.1', { local: false })).not.toThrow();
    expect(() => generate('127.0.0.1', { local: false })).toThrow(/Rate limit/i);
  });

  it('still exempts a true local caller', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', rateLimit: 1 });
    const generate = service.generatePairingCode.bind(service) as (ip: string, opts?: { local?: boolean }) => { url: string };

    for (let i = 0; i < 5; i++) {
      expect(() => generate('127.0.0.1', { local: true })).not.toThrow();
    }
  });
});
