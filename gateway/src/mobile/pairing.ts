import * as crypto from 'crypto';

interface PairingNonce {
  nonce: string;
  expiresAt: number;
  used: boolean;
}

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

export interface PairingConfig {
  apiToken: string;
  tailscaleUrl: string;
  /** TTL in ms (default 5 min) */
  ttlMs?: number;
  /** Max codes per IP per minute (default 5) */
  rateLimit?: number;
}

export class PairingService {
  private nonces: Map<string, PairingNonce> = new Map();
  private rateLimits: Map<string, RateLimitBucket> = new Map();
  private readonly apiToken: string;
  private readonly tailscaleUrl: string;
  private readonly ttlMs: number;
  private readonly rateLimit: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: PairingConfig) {
    this.apiToken = config.apiToken;
    this.tailscaleUrl = config.tailscaleUrl;
    this.ttlMs = config.ttlMs ?? 5 * 60 * 1000;
    this.rateLimit = config.rateLimit ?? 5;
    // Periodic cleanup every 60s
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  generatePairingCode(ip: string): { url: string } {
    const isLoopback = ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::1' || ip === '::ffff:127.0.0.1';

    if (!isLoopback) {
      this.checkRateLimit(ip);
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const exp = Date.now() + this.ttlMs;

    this.nonces.set(nonce, { nonce, expiresAt: exp, used: false });

    const params = new URLSearchParams({
      url: this.tailscaleUrl,
      token: this.apiToken,
      v: '1',
      exp: String(exp),
      nonce,
    });

    return { url: `mafw://pair?${params.toString()}` };
  }

  consumeNonce(nonce: string): boolean {
    const entry = this.nonces.get(nonce);
    if (!entry) return false;
    if (entry.used) return false;
    if (Date.now() > entry.expiresAt) return false;
    entry.used = true;
    return true;
  }

  /** Expire a nonce (test helper). */
  expireNonce(nonce: string): void {
    const entry = this.nonces.get(nonce);
    if (entry) entry.expiresAt = 0;
  }

  private checkRateLimit(ip: string): void {
    const now = Date.now();
    const bucket = this.rateLimits.get(ip);
    if (!bucket || now - bucket.windowStart > 60_000) {
      this.rateLimits.set(ip, { count: 1, windowStart: now });
      return;
    }
    bucket.count++;
    if (bucket.count > this.rateLimit) {
      throw new Error(`Rate limit exceeded for ${ip}: max ${this.rateLimit} codes per minute`);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [nonce, entry] of this.nonces) {
      if (entry.used || now > entry.expiresAt) {
        this.nonces.delete(nonce);
      }
    }
    for (const [ip, bucket] of this.rateLimits) {
      if (now - bucket.windowStart > 60_000) {
        this.rateLimits.delete(ip);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.nonces.clear();
    this.rateLimits.clear();
  }
}
