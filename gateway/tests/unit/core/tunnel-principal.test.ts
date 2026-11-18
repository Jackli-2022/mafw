/**
 * M0: tunneled requests must never inherit loopback `local` trust.
 * These tests pin the principal precedence: valid credentials win, the marker
 * only downgrades a credential-less request to `relay`, and Cloudflare's
 * forwarding header is the fail-closed hint when the marker is missing.
 */
import {
  TUNNEL_HEADER,
  isLocalPrincipal,
  isRelayPrincipal,
  resolvePrincipal,
} from '../../../src/core/auth';

const SECRET = 'a'.repeat(64);
const base = {
  apiToken: 'svc-token',
  humanToken: 'human-token',
  tunnelSecret: SECRET,
};

describe('relay principal (M0)', () => {
  it('marks a marker-bearing request as relay when no credential is present', () => {
    const p = resolvePrincipal(
      { remoteAddress: '127.0.0.1', headers: { [TUNNEL_HEADER]: SECRET } },
      base,
    );
    expect(p).toEqual({ kind: 'relay', method: 'tunnel' });
    expect(isRelayPrincipal(p)).toBe(true);
    expect(isLocalPrincipal(p)).toBe(false);
  });

  it('keeps a device token human through the tunnel', () => {
    const p = resolvePrincipal(
      {
        remoteAddress: '127.0.0.1',
        headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_abc' },
      },
      { ...base, verifyDeviceToken: () => ({ deviceId: 'd1' }) },
    );
    expect(p).toEqual({ kind: 'human', method: 'device-token', deviceId: 'd1' });
  });

  it('keeps the human token human through the tunnel', () => {
    const p = resolvePrincipal(
      {
        remoteAddress: '127.0.0.1',
        headers: { [TUNNEL_HEADER]: SECRET, 'x-mafw-human-token': 'human-token' },
      },
      base,
    );
    expect(p).toEqual({ kind: 'human', method: 'human-token' });
  });

  it('treats a forged marker plus Cloudflare forwarding headers as relay, never local', () => {
    const p = resolvePrincipal(
      {
        remoteAddress: '127.0.0.1',
        headers: { [TUNNEL_HEADER]: 'forged', 'cf-connecting-ip': '1.2.3.4' },
      },
      base,
    );
    expect(p).toEqual({ kind: 'relay', method: 'tunnel' });
  });

  it('leaves a plain loopback request local', () => {
    const p = resolvePrincipal({ remoteAddress: '127.0.0.1', headers: {} }, base);
    expect(p).toEqual({ kind: 'local', method: 'loopback' });
    expect(isLocalPrincipal(p)).toBe(true);
  });

  it('does not authorize a forged marker from a non-loopback address', () => {
    const p = resolvePrincipal(
      { remoteAddress: '203.0.113.9', headers: { [TUNNEL_HEADER]: 'forged' } },
      base,
    );
    expect(p).toEqual({ kind: 'anonymous', method: 'none' });
  });
});
