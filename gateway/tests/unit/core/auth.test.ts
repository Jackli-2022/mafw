/**
 * Tests for gateway/src/core/auth.ts
 *
 * Covers: isLoopbackAddr, authorizeRequest, authorizeWsUpgrade, redactLog
 */

import {
  isLoopbackAddr,
  authorizeRequest,
  authorizeWsUpgrade,
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
// authorizeWsUpgrade
// ---------------------------------------------------------------------------

describe('authorizeWsUpgrade', () => {
  const wsBase = {
    headers: {} as Record<string, string | undefined>,
    url: 'ws://localhost:3000/ws',
    host: 'localhost:3000',
  };

  describe('loopback bypass', () => {
    it('allows loopback', () => {
      expect(
        authorizeWsUpgrade({ ...wsBase, remoteAddress: '127.0.0.1' }, 'secret').ok
      ).toBe(true);
    });
  });

  describe('remote with valid token', () => {
    it('allows via Bearer header', () => {
      const result = authorizeWsUpgrade(
        { ...wsBase, remoteAddress: '10.0.0.1', headers: { authorization: 'Bearer secret' } },
        'secret'
      );
      expect(result.ok).toBe(true);
      expect(result.rejectResponse).toBeUndefined();
    });

    it('allows via X-API-Token', () => {
      const result = authorizeWsUpgrade(
        { ...wsBase, remoteAddress: '10.0.0.1', headers: { 'x-api-token': 'secret' } },
        'secret'
      );
      expect(result.ok).toBe(true);
    });

    it('allows via query param', () => {
      const result = authorizeWsUpgrade(
        { ...wsBase, remoteAddress: '10.0.0.1', url: 'ws://localhost:3000/ws?token=secret' },
        'secret'
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('rejection', () => {
    it('rejects remote with empty apiToken', () => {
      const result = authorizeWsUpgrade(
        { ...wsBase, remoteAddress: '10.0.0.1' },
        ''
      );
      expect(result.ok).toBe(false);
      expect(result.rejectResponse).toBeDefined();
      expect(result.rejectResponse!.toString()).toContain('401 Unauthorized');
    });

    it('rejects wrong token', () => {
      const result = authorizeWsUpgrade(
        { ...wsBase, remoteAddress: '10.0.0.1', headers: { authorization: 'Bearer wrong' } },
        'secret'
      );
      expect(result.ok).toBe(false);
      expect(result.rejectResponse!.toString()).toContain('401');
    });

    it('rejects no token', () => {
      const result = authorizeWsUpgrade(
        { ...wsBase, remoteAddress: '10.0.0.1' },
        'secret'
      );
      expect(result.ok).toBe(false);
    });
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
});
