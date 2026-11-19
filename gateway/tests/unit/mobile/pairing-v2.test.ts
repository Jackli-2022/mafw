/**
 * E5a-3 — pairing v2: the deep link carries NO gateway credential.
 *
 *   v1 (legacy): orcalore://pair?url=…&token=<shared apiToken>&v=1&exp&nonce
 *   v2 (this):   orcalore://pair?url=…&v=2&exp&nonce
 *
 * The nonce is exchanged at `POST /api/mobile/pairing/verify` for a per-device
 * token. Rate limiting / loopback exemption / single-use semantics are
 * unchanged from v1.
 */
import { PairingService } from '../../../src/mobile/pairing';

describe('PairingService v2 (E5a-3)', () => {
  let service: PairingService;

  afterEach(() => {
    service?.destroy();
    jest.restoreAllMocks();
  });

  it('emits v=2 with url/exp/nonce and no token at all', () => {
    service = new PairingService({
      apiToken: 'shared-api-token-must-not-leak',
      tailscaleUrl: 'http://pc.tailnet.ts.net:3000',
    });

    const { url } = service.generatePairingCode('127.0.0.1');
    const parsed = new URL(url);

    expect(url.startsWith('orcalore://pair?')).toBe(true);
    expect(parsed.host).toBe('pair');
    expect(parsed.searchParams.get('v')).toBe('2');
    expect(parsed.searchParams.get('url')).toBe('http://pc.tailnet.ts.net:3000');
    expect(parsed.searchParams.get('nonce')).toMatch(/^[0-9a-f]{32}$/);
    expect(Number(parsed.searchParams.get('exp'))).toBeGreaterThan(Date.now());

    expect(parsed.searchParams.has('token')).toBe(false);
    expect(url).not.toContain('shared-api-token-must-not-leak');
    expect(url).not.toMatch(/[?&]token=/);
  });

  it('keeps the nonce single-use', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000' });
    const nonce = new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;

    expect(service.consumeNonce(nonce)).toBe(true);
    expect(service.consumeNonce(nonce)).toBe(false);
  });

  it('rejects an expired nonce', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', ttlMs: 1_000 });
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const nonce = new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;

    now.mockReturnValue(start + 1_001);
    expect(service.consumeNonce(nonce)).toBe(false);
  });

  it('keeps the per-IP rate limit for non-loopback callers', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', rateLimit: 2 });
    const ip = '203.0.113.44';

    expect(() => service.generatePairingCode(ip)).not.toThrow();
    expect(() => service.generatePairingCode(ip)).not.toThrow();
    expect(() => service.generatePairingCode(ip)).toThrow(/Rate limit exceeded/);
  });

  it('keeps loopback exempt from the rate limit', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', rateLimit: 1 });

    for (let i = 0; i < 5; i++) {
      expect(() => service.generatePairingCode('127.0.0.1')).not.toThrow();
    }
  });

  it('uses a temporary remote-access override and restores the configured URL', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://192.168.1.5:3000' });

    service.setBaseUrlOverride('https://happy-dog.trycloudflare.com/');
    expect(new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('url'))
      .toBe('https://happy-dog.trycloudflare.com');

    service.clearBaseUrlOverride();
    expect(new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('url'))
      .toBe('http://192.168.1.5:3000');
  });

  it('keeps the override across a config hot-update until it is cleared', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000' });
    service.setBaseUrlOverride('https://tunnel.example.com');

    service.updateConfig({ tailscaleUrl: 'http://new-lan:3000' });
    expect(new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('url'))
      .toBe('https://tunnel.example.com');

    service.clearBaseUrlOverride();
    expect(new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('url'))
      .toBe('http://new-lan:3000');
  });

  it('adds relayUrl/fp only when a relay endpoint is configured', () => {
    service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000' });
    const fp = 'ab'.repeat(32);

    const bare = new URL(service.generatePairingCode('127.0.0.1').url).searchParams;
    expect(bare.get('relayUrl')).toBeNull();
    expect(bare.get('fp')).toBeNull();

    service.setRelayEndpoint({ url: 'https://room.relay.example.com/', fingerprint: fp });
    const linked = new URL(service.generatePairingCode('127.0.0.1').url).searchParams;
    expect(linked.get('url')).toBe('http://pc:3000');
    expect(linked.get('relayUrl')).toBe('https://room.relay.example.com');
    expect(linked.get('fp')).toBe(fp);

    service.setRelayEndpoint(null);
    expect(new URL(service.generatePairingCode('127.0.0.1').url).searchParams.get('relayUrl')).toBeNull();
  });
});
