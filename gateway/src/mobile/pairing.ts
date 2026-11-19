import * as crypto from 'crypto';

function hashNonce(nonce: string): string {
  return crypto.createHash('sha256').update(nonce).digest('hex');
}

interface PairingNonce {
  /** sha256 hash of the raw nonce — raw value never stored (hash storage) */
  hash: string;
  expiresAt: number;
}

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

export interface PairingConfig {
  /**
   * @deprecated E5a-3: pairing v2 links no longer embed the shared gateway
   * token. Kept in the signature so existing callers/tests keep compiling;
   * the value is not persisted or serialized anywhere.
   */
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
  private configuredBaseUrl: string;
  private overrideBaseUrl: string | null = null;
  private relayEndpoint: { url: string; fingerprint: string } | null = null;
  private readonly ttlMs: number;
  private readonly rateLimit: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: PairingConfig) {
    // `config.apiToken` is intentionally ignored (v2 pairs a device token via
    // `/api/mobile/pairing/verify`); the parameter stays for compatibility.
    this.configuredBaseUrl = config.tailscaleUrl;
    this.ttlMs = config.ttlMs ?? 5 * 60 * 1000;
    this.rateLimit = config.rateLimit ?? 5;
    // Periodic cleanup every 60s — unref so it doesn't pin the process exit
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // allow process to exit gracefully when this is the last handle
    if ((this.cleanupTimer as any).unref) (this.cleanupTimer as any).unref();
  }

  /** Current base URL serialized into pairing links (override > configured). */
  get baseUrl(): string {
    return this.overrideBaseUrl ?? this.configuredBaseUrl;
  }

  /**
   * Temporary remote-access URL (Cloudflare/OpenTunnel). While set, pairing
   * links use it; stopping the tunnel clears it and restores the configured
   * LAN/Tailscale URL. Runtime-only: never persisted.
   */
  setBaseUrlOverride(url: string): void {
    const normalized = url.trim().replace(/\/+$/, '');
    this.overrideBaseUrl = normalized || null;
  }

  clearBaseUrlOverride(): void {
    this.overrideBaseUrl = null;
  }

  /**
   * M2: advertise the stable relay room + the gateway certificate fingerprint.
   * `url` stays the LAN/Tailscale address; the app may prefer relay when LAN
   * is unreachable. Passing null restores the pre-relay link shape.
   */
  setRelayEndpoint(endpoint: { url: string; fingerprint: string } | null): void {
    if (!endpoint) {
      this.relayEndpoint = null;
      return;
    }
    const url = endpoint.url.trim().replace(/\/+$/, '');
    const fingerprint = endpoint.fingerprint.trim().toLowerCase();
    this.relayEndpoint = url && fingerprint ? { url, fingerprint } : null;
  }

  /**
   * Generate a one-time pairing URL (v2). Rate-limit applies to non-local
   * callers only; a true `local` principal is exempt because the operator is
   * local and trusted (spec §6.1). A relayed caller reaches us over a loopback
   * socket, so the decision must come from the principal, not the IP.
   *
   * E5a-3: the URL carries `url` / `v=2` / `exp` / `nonce` — never a gateway
   * credential. The nonce is exchanged at `POST /api/mobile/pairing/verify`
   * for a revocable per-device token.
   */
  generatePairingCode(ip: string, opts?: { local?: boolean }): { url: string } {
    const local = opts?.local ?? (
      ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::1' || ip === '::ffff:127.0.0.1'
    );

    if (!local) {
      this.checkRateLimit(ip);
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const exp = Date.now() + this.ttlMs;

    this.nonces.set(hashNonce(nonce), { hash: hashNonce(nonce), expiresAt: exp });

    const params = new URLSearchParams({
      url: this.baseUrl,
      v: '2',
      exp: String(exp),
      nonce,
    });
    if (this.relayEndpoint) {
      params.set('relayUrl', this.relayEndpoint.url);
      params.set('fp', this.relayEndpoint.fingerprint);
    }

    return { url: `orcalore://pair?${params.toString()}` };
  }

  /**
   * Consume a nonce: check TTL validity and delete (single-use by deletion).
   * Returns true if the nonce was valid and consumed.
   */
  consumeNonce(nonce: string): boolean {
    const h = hashNonce(nonce);
    const entry = this.nonces.get(h);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(h);
      return false;
    }
    this.nonces.delete(h);
    return true;
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
      if (now > entry.expiresAt) {
        this.nonces.delete(nonce);
      }
    }
    for (const [ip, bucket] of this.rateLimits) {
      if (now - bucket.windowStart > 60_000) {
        this.rateLimits.delete(ip);
      }
    }
  }

  /**
   * Hot-update the tailnet base after config changes (no restart).
   * `apiToken` is accepted for compatibility but no longer embedded in links.
   */
  updateConfig(opts: { apiToken?: string; tailscaleUrl?: string }): void {
    if (opts.tailscaleUrl !== undefined) this.configuredBaseUrl = opts.tailscaleUrl;
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
