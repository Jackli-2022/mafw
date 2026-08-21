import { PairingService } from '../../../gateway/src/mobile/pairing';

describe('PairingService', () => {
  let service: PairingService;

  beforeEach(() => {
    service = new PairingService({
      apiToken: 'test-api-token-123',
      tailscaleUrl: 'https://my-tailnet:3000',
    });
  });

  afterEach(() => {
    service.destroy();
  });

  describe('generatePairingCode', () => {
    it('returns a mafw://pair URL with required params', () => {
      const result = service.generatePairingCode('100.64.0.5');
      expect(result.url).toMatch(/^mafw:\/\/pair\?/);
      expect(result.url).toContain('v=1');
      expect(result.url).toContain('token=test-api-token-123');
      expect(result.url).toContain('exp=');
      expect(result.url).toContain('nonce=');
    });

    it('uses tailscaleUrl as the url param', () => {
      const result = service.generatePairingCode('100.64.0.5');
      expect(result.url).toContain('url=https%3A%2F%2Fmy-tailnet%3A3000');
    });

    it('nonce is a 32-char hex string', () => {
      const result = service.generatePairingCode('100.64.0.5');
      const parsed = new URL(result.url);
      const nonce = parsed.searchParams.get('nonce');
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('exp is a future timestamp (5min from now)', () => {
      const before = Date.now() + 5 * 60 * 1000 - 1000;
      const result = service.generatePairingCode('100.64.0.5');
      const parsed = new URL(result.url);
      const exp = parseInt(parsed.searchParams.get('exp') || '0', 10);
      const after = Date.now() + 5 * 60 * 1000 + 1000;
      expect(exp).toBeGreaterThanOrEqual(before);
      expect(exp).toBeLessThanOrEqual(after);
    });

    it('nonce can be consumed exactly once', () => {
      const result = service.generatePairingCode('100.64.0.5');
      const parsed = new URL(result.url);
      const nonce = parsed.searchParams.get('nonce')!;

      // First consumption succeeds
      const consumed = service.consumeNonce(nonce);
      expect(consumed).toBe(true);

      // Second consumption fails
      const second = service.consumeNonce(nonce);
      expect(second).toBe(false);
    });

    it('expired nonce is rejected', async () => {
      // Create service with 1ms TTL
      const shortTtlService = new PairingService({
        apiToken: 'test-api-token-123',
        tailscaleUrl: 'https://my-tailnet:3000',
        ttlMs: 1,
      });

      const result = shortTtlService.generatePairingCode('100.64.0.5');
      const parsed = new URL(result.url);
      const nonce = parsed.searchParams.get('nonce')!;

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      const consumed = shortTtlService.consumeNonce(nonce);
      expect(consumed).toBe(false);
      shortTtlService.destroy();
    });
  });

  describe('rate limiting', () => {
    it('allows up to 5 requests per IP per minute', () => {
      for (let i = 0; i < 5; i++) {
        const result = service.generatePairingCode('10.0.0.1');
        expect(result.url).toBeTruthy();
      }
      // 6th should be rejected
      expect(() => service.generatePairingCode('10.0.0.1')).toThrow(/rate limit/i);
    });

    it('rate limits are per-IP', () => {
      for (let i = 0; i < 5; i++) {
        service.generatePairingCode('10.0.0.1');
      }
      // Different IP still works
      const result = service.generatePairingCode('10.0.0.2');
      expect(result.url).toBeTruthy();
    });

    it('loopback addresses are exempt from rate limiting', () => {
      for (let i = 0; i < 10; i++) {
        const result = service.generatePairingCode('127.0.0.1');
        expect(result.url).toBeTruthy();
      }
    });
  });

  describe('destroy', () => {
    it('clears all state', () => {
      service.generatePairingCode('10.0.0.1');
      service.destroy();
      // After destroy, should be able to generate again (fresh state)
      const result = service.generatePairingCode('10.0.0.1');
      expect(result.url).toBeTruthy();
    });
  });
});
