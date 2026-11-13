/**
 * Tests for gateway/src/core/auth.ts
 *
 * Covers: isLoopbackAddr, authorizeRequest, WS rejection bytes, redactLog.
 * `resolvePrincipal` (including the WS upgrade credential matrix that the dead
 * `authorizeWsUpgrade` used to duplicate) lives in `principal.test.ts`.
 */

import {
  isLoopbackAddr,
  authorizeRequest,
  WS_UNAUTHORIZED_RESPONSE,
  redactLog,
} from '../../../src/core/auth';

// ---------------------------------------------------------------------------
// isLoopbackAddr
// ---------------------------------------------------------------------------

describe('isLoopbackAddr', () => {
  it('returns true for 127.0.0.1', () => {
    expect(isLoopbackAddr('127.0.0.1')).toBe(true);
  });

  it('returns true for other 127.x.x.x addresses', () => {
    expect(isLoopbackAddr('127.0.0.2')).toBe(true);
    expect(isLoopbackAddr('127.255.255.255')).toBe(true);
  });

  it('returns true for IPv6 ::1', () => {
    expect(isLoopbackAddr('::1')).toBe(true);
  });

  it('returns true for IPv4-mapped IPv6 loopback', () => {
    expect(isLoopbackAddr('::ffff:127.0.0.1')).toBe(true);
  });

  it('returns false for empty / undefined', () => {
    expect(isLoopbackAddr('')).toBe(false);
    expect(isLoopbackAddr(undefined as any)).toBe(false);
  });

  it('returns false for public addresses', () => {
    expect(isLoopbackAddr('192.168.1.1')).toBe(false);
    expect(isLoopbackAddr('10.0.0.1')).toBe(false);
    expect(isLoopbackAddr('8.8.8.8')).toBe(false);
    expect(isLoopbackAddr('2001:db8::1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// authorizeRequest
// ---------------------------------------------------------------------------

describe('authorizeRequest', () => {
  const base = {
    headers: {} as Record<string, string | undefined>,
    url: '/',
    host: 'localhost',
  };

  describe('loopback bypass', () => {
    it('allows loopback regardless of apiToken', () => {
      expect(
        authorizeRequest({ ...base, remoteAddress: '127.0.0.1' }, 'secret')
      ).toBe(true);
    });

    it('allows loopback even with empty apiToken', () => {
      expect(
        authorizeRequest({ ...base, remoteAddress: '127.0.0.1' }, '')
      ).toBe(true);
    });
  });

  describe('remote requests with apiToken', () => {
    it('allows via Authorization: Bearer', () => {
      expect(
        authorizeRequest(
          { ...base, remoteAddress: '10.0.0.1', headers: { authorization: 'Bearer secret' } },
          'secret'
        )
      ).toBe(true);
    });

    it('allows via X-API-Token header', () => {
      expect(
        authorizeRequest(
          { ...base, remoteAddress: '10.0.0.1', headers: { 'x-api-token': 'secret' } },
          'secret'
        )
      ).toBe(true);
    });

    it('allows via ?token= query param', () => {
      expect(
        authorizeRequest(
          { ...base, remoteAddress: '10.0.0.1', url: '/api/test?token=secret' },
          'secret'
        )
      ).toBe(true);
    });

    it('allows via ?token= with other params', () => {
      expect(
        authorizeRequest(
          { ...base, remoteAddress: '10.0.0.1', url: '/api/test?foo=bar&token=secret' },
          'secret'
        )
      ).toBe(true);
    });

    it('rejects wrong token', () => {
      expect(
        authorizeRequest(
          { ...base, remoteAddress: '10.0.0.1', headers: { authorization: 'Bearer wrong' } },
          'secret'
        )
      ).toBe(false);
    });

    it('rejects no token at all', () => {
      expect(
        authorizeRequest({ ...base, remoteAddress: '10.0.0.1' }, 'secret')
      ).toBe(false);
    });
  });

  describe('empty apiToken + remote', () => {
    it('denies all remote requests when apiToken is empty', () => {
      expect(
        authorizeRequest({ ...base, remoteAddress: '10.0.0.1' }, '')
      ).toBe(false);
    });
  });

  describe('Bearer case sensitivity', () => {
    it('rejects "bearer" (lowercase)', () => {
      expect(
        authorizeRequest(
          { ...base, remoteAddress: '10.0.0.1', headers: { authorization: 'bearer secret' } },
          'secret'
        )
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// WS upgrade rejection bytes (E8-5)
//
// The removed `authorizeWsUpgrade` duplicated the `resolvePrincipal` credential
// matrix (Bearer / X-API-Token / ?token= / loopback / no credentials), which
// `principal.test.ts` already covers in full. What the upgrade path still owes
// on the wire is the byte-identical 401 it writes before destroying the socket.
// ---------------------------------------------------------------------------

describe('WS_UNAUTHORIZED_RESPONSE', () => {
  it('is the exact raw 401 the upgrade path writes before destroying the socket', () => {
    expect(WS_UNAUTHORIZED_RESPONSE.toString()).toBe('HTTP/1.1 401 Unauthorized\r\n\r\n');
  });
});

// ---------------------------------------------------------------------------
// redactLog
// ---------------------------------------------------------------------------

describe('redactLog', () => {
  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer sk-abc123xyz';
    const result = redactLog(input);
    expect(result).toBe('Authorization: Bearer ***');
    expect(result).not.toContain('sk-abc123xyz');
  });

  it('redacts ?token= query values', () => {
    const input = '/api/test?token=supersecret';
    const result = redactLog(input);
    expect(result).toBe('/api/test?token=***');
  });

  it('redacts &token= query values', () => {
    const input = '/api/test?foo=bar&token=supersecret&baz=1';
    const result = redactLog(input);
    expect(result).toBe('/api/test?foo=bar&token=***&baz=1');
  });

  it('redacts multiple tokens in same string', () => {
    const input = 'Bearer tok1 token=tok2';
    const result = redactLog(input);
    // Bearer is redacted; bare 'token=' (no ?/& prefix) is NOT a URL query param, so untouched
    expect(result).toBe('Bearer *** token=tok2');
  });

  it('redacts multiple URL-style tokens in same string', () => {
    const input = 'GET /api?token=abc&foo=bar&token=def';
    const result = redactLog(input);
    expect(result).toBe('GET /api?token=***&foo=bar&token=***');
  });

  it('does not touch clean strings', () => {
    const input = 'GET /api/test 200 OK';
    expect(redactLog(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(redactLog('')).toBe('');
  });

  // -------------------------------------------------------------------------
  // E5a credential headers (F1)
  // -------------------------------------------------------------------------

  const HUMAN_TOKEN = 'a'.repeat(64);
  const DEVICE_TOKEN = `dev_${'A1b2C3d4E5f6G7h8I9j0K1l2'}`;

  it('redacts credential headers in the JSON shape the logger emits', () => {
    const input = JSON.stringify({
      'x-mafw-human-token': HUMAN_TOKEN,
      'x-mafw-device-token': DEVICE_TOKEN,
    });

    const out = redactLog(input);

    expect(out).toBe('{"x-mafw-human-token":"***","x-mafw-device-token":"***"}');
    expect(out).not.toContain(HUMAN_TOKEN);
    expect(out).not.toContain(DEVICE_TOKEN);
  });

  it('redacts credential headers in single-quoted JSON', () => {
    const input = `{'x-mafw-human-token':'${HUMAN_TOKEN}','x-mafw-device-token':'${DEVICE_TOKEN}'}`;

    expect(redactLog(input)).toBe("{'x-mafw-human-token':'***','x-mafw-device-token':'***'}");
  });

  it('redacts credential headers in header form', () => {
    expect(redactLog(`X-MAFW-Human-Token: ${HUMAN_TOKEN}`)).toBe('X-MAFW-Human-Token: ***');
    expect(redactLog(`x-mafw-device-token=${DEVICE_TOKEN}`)).toBe('x-mafw-device-token=***');
  });

  it('redacts dev_ tokens anywhere (pairing responses, bare values)', () => {
    const pairing = JSON.stringify({ ok: true, token: DEVICE_TOKEN, deviceId: 'dev-1' });

    const out = redactLog(pairing);

    expect(out).toBe('{"ok":true,"token":"dev_***","deviceId":"dev-1"}');
    expect(out).not.toContain(DEVICE_TOKEN);
    expect(redactLog(`paired with ${DEVICE_TOKEN} ok`)).toBe('paired with dev_*** ok');
  });

  it('does not redact arbitrary 64-hex values (avoids over-redaction)', () => {
    const hash = 'b'.repeat(64);
    expect(redactLog(`commit ${hash} built`)).toBe(`commit ${hash} built`);
  });

  it('leaves benign text and short dev-ish names alone', () => {
    expect(redactLog('GET /api/test 200 OK')).toBe('GET /api/test 200 OK');
    expect(redactLog('dev_mode enabled')).toBe('dev_mode enabled');
  });

});
