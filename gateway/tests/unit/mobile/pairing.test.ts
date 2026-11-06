/**
 * Orcalore deep-link lockstep — the gateway must emit `orcalore://pair`
 * (mobile parser + Manifest accept the same scheme; legacy `mafw://` is dead).
 */
import { PairingService } from '../../../src/mobile/pairing';

describe('PairingService deep link (Orcalore)', () => {
  let service: PairingService;

  beforeEach(() => {
    service = new PairingService({
      apiToken: 'api-token-abc',
      tailscaleUrl: 'http://pc.tailnet.ts.net:3000',
    });
  });

  afterEach(() => {
    service.destroy();
  });

  it('generates an orcalore://pair URL carrying url/token/nonce/exp', () => {
    const { url } = service.generatePairingCode('127.0.0.1');

    expect(url.startsWith('orcalore://pair?')).toBe(true);
    expect(url.startsWith('mafw://pair')).toBe(false);

    const parsed = new URL(url);
    expect(parsed.host).toBe('pair');
    expect(parsed.searchParams.get('url')).toBe('http://pc.tailnet.ts.net:3000');
    expect(parsed.searchParams.get('token')).toBe('api-token-abc');
    expect(parsed.searchParams.get('v')).toBe('1');
    expect(parsed.searchParams.get('nonce')).toMatch(/^[0-9a-f]{32}$/);
    expect(Number(parsed.searchParams.get('exp'))).toBeGreaterThan(Date.now());
  });

  it('keeps the nonce single-use semantics', () => {
    const { url } = service.generatePairingCode('127.0.0.1');
    const nonce = new URL(url).searchParams.get('nonce')!;

    expect(service.consumeNonce(nonce)).toBe(true);
    expect(service.consumeNonce(nonce)).toBe(false);
  });
});
