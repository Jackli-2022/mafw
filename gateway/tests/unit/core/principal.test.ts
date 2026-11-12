/**
 * E5a-1 — principal resolution matrix (spec §3.3).
 *
 * Order is load-bearing: human token → device token → shared apiToken →
 * loopback → anonymous. A wrong device token never grants human and (F4) falls
 * through to the remaining credentials — a stale device header must not shadow
 * a valid shared apiToken. A wrong human token on loopback degrades to `local`.
 */
import {
  humanOnlyDenied,
  isHumanPrincipal,
  resolvePrincipal,
  type AuthRequest,
  type Principal,
} from '../../../src/core/auth';

const HUMAN = 'h'.repeat(64);
const SERVICE = 'shared-service-token';
const LOOPBACK = '127.0.0.1';
const REMOTE = '203.0.113.9';

function req(over: Partial<AuthRequest> & { remoteAddress?: string } = {}): AuthRequest {
  return {
    remoteAddress: over.remoteAddress ?? LOOPBACK,
    headers: over.headers ?? {},
    url: over.url ?? '/api/pods/p1/goals/g1/accept',
    host: over.host ?? 'localhost:3000',
  };
}

const baseOpts = {
  apiToken: SERVICE,
  humanToken: HUMAN,
  verifyDeviceToken: (token: string) => (token === 'dev_good' ? { deviceId: 'dev-1' } : null),
};

function resolve(r: AuthRequest, opts: Partial<typeof baseOpts> = {}): Principal {
  return resolvePrincipal(r, { ...baseOpts, ...opts });
}

describe('resolvePrincipal — human token', () => {
  it('resolves a matching X-MAFW-Human-Token to human/human-token', () => {
    expect(resolve(req({ headers: { 'x-mafw-human-token': HUMAN } }))).toEqual({
      kind: 'human',
      method: 'human-token',
    });
  });

  it('resolves the human token from a remote address too', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { 'x-mafw-human-token': HUMAN } }))).toEqual({
      kind: 'human',
      method: 'human-token',
    });
  });

  it('never matches when the configured human token is empty', () => {
    expect(resolve(req({ headers: { 'x-mafw-human-token': '' } }), { humanToken: '' })).toEqual({
      kind: 'local',
      method: 'loopback',
    });
  });

  it('does not throw on a length mismatch (constant-time guard)', () => {
    expect(() => resolve(req({ headers: { 'x-mafw-human-token': 'short' } }))).not.toThrow();
    expect(resolve(req({ headers: { 'x-mafw-human-token': 'short' } })).kind).toBe('local');
  });

  it('degrades a wrong human token on loopback to local (not human)', () => {
    expect(resolve(req({ headers: { 'x-mafw-human-token': 'f'.repeat(64) } }))).toEqual({
      kind: 'local',
      method: 'loopback',
    });
  });

  it('degrades a wrong human token from a remote address to anonymous when no other credential is present', () => {
    expect(resolve(req({
      remoteAddress: REMOTE,
      headers: { 'x-mafw-human-token': 'f'.repeat(64) },
    }))).toEqual({ kind: 'anonymous', method: 'none' });
  });

  it('lets a wrong human token fall through to a valid shared apiToken (only devices fail closed)', () => {
    expect(resolve(req({
      remoteAddress: REMOTE,
      headers: { 'x-mafw-human-token': 'f'.repeat(64), authorization: `Bearer ${SERVICE}` },
    }))).toEqual({ kind: 'service', method: 'api-token' });
  });

  it('wins over a device token and the shared apiToken (priority)', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: {
      'x-mafw-human-token': HUMAN,
      'x-mafw-device-token': 'dev_good',
      authorization: `Bearer ${SERVICE}`,
    } }))).toEqual({ kind: 'human', method: 'human-token' });
  });
});

describe('resolvePrincipal — device token', () => {
  it('resolves X-MAFW-Device-Token through the verifier', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { 'x-mafw-device-token': 'dev_good' } }))).toEqual({
      kind: 'human',
      method: 'device-token',
      deviceId: 'dev-1',
    });
  });

  it('resolves Authorization: Bearer dev_… through the verifier', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { authorization: 'Bearer dev_good' } }))).toEqual({
      kind: 'human',
      method: 'device-token',
      deviceId: 'dev-1',
    });
  });

  it('wins over the shared apiToken (priority)', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: {
      'x-mafw-device-token': 'dev_good',
      'x-api-token': SERVICE,
    } }))).toEqual({ kind: 'human', method: 'device-token', deviceId: 'dev-1' });
  });

  it('treats an invalid device token on loopback as local, not service', () => {
    expect(resolve(req({ headers: { 'x-mafw-device-token': 'dev_revoked' } }))).toEqual({
      kind: 'local',
      method: 'loopback',
    });
  });

  it('lets an invalid device token fall through to a valid shared apiToken (F4)', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: {
      authorization: 'Bearer dev_revoked',
      'x-api-token': SERVICE,
    } }))).toEqual({ kind: 'service', method: 'api-token' });
  });

  it('lets a stale device header fall through to a valid Bearer apiToken (F4)', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: {
      'x-mafw-device-token': 'dev_revoked',
      authorization: `Bearer ${SERVICE}`,
    } }))).toEqual({ kind: 'service', method: 'api-token' });
  });

  it('resolves an apiToken that itself starts with dev_ via Authorization as service (F4)', () => {
    const devPrefixedService = 'dev_shared_service_token';
    expect(resolve(req({ remoteAddress: REMOTE, headers: {
      authorization: `Bearer ${devPrefixedService}`,
    } }), { apiToken: devPrefixedService })).toEqual({ kind: 'service', method: 'api-token' });
  });

  it('leaves an invalid device token without other credentials as local on loopback / anonymous remotely', () => {
    expect(resolve(req({ headers: { 'x-mafw-device-token': 'dev_revoked' } }))).toEqual({
      kind: 'local',
      method: 'loopback',
    });
    expect(resolve(req({ remoteAddress: REMOTE, headers: { 'x-mafw-device-token': 'dev_revoked' } }))).toEqual({
      kind: 'anonymous',
      method: 'none',
    });
  });

  it('treats a device token as anonymous when no verifier is wired (fail-closed)', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { 'x-mafw-device-token': 'dev_good' } }), {
      verifyDeviceToken: undefined,
    })).toEqual({ kind: 'anonymous', method: 'none' });
  });

  it('survives a verifier that throws', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { 'x-mafw-device-token': 'dev_good' } }), {
      verifyDeviceToken: () => { throw new Error('store corrupt'); },
    })).toEqual({ kind: 'anonymous', method: 'none' });
  });
});

describe('resolvePrincipal — shared apiToken', () => {
  it('resolves Bearer apiToken to service/api-token', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { authorization: `Bearer ${SERVICE}` } }))).toEqual({
      kind: 'service',
      method: 'api-token',
    });
  });

  it('resolves X-API-Token to service/api-token', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { 'x-api-token': SERVICE } }))).toEqual({
      kind: 'service',
      method: 'api-token',
    });
  });

  it('resolves ?token= to service/api-token', () => {
    expect(resolve(req({
      remoteAddress: REMOTE,
      url: `/api/pods/p1/goals/g1/accept?token=${SERVICE}`,
    }))).toEqual({ kind: 'service', method: 'api-token' });
  });

  it('never matches an empty configured apiToken', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { authorization: 'Bearer ' } }), {
      apiToken: '',
    })).toEqual({ kind: 'anonymous', method: 'none' });
  });

  it('rejects a wrong apiToken from remote as anonymous', () => {
    expect(resolve(req({ remoteAddress: REMOTE, headers: { authorization: 'Bearer nope' } }))).toEqual({
      kind: 'anonymous',
      method: 'none',
    });
  });
});

describe('resolvePrincipal — loopback / anonymous', () => {
  it('resolves a credential-less loopback request to local/loopback', () => {
    expect(resolve(req())).toEqual({ kind: 'local', method: 'loopback' });
  });

  it('resolves a credential-less remote request to anonymous/none', () => {
    expect(resolve(req({ remoteAddress: REMOTE }))).toEqual({ kind: 'anonymous', method: 'none' });
  });
});

describe('isHumanPrincipal', () => {
  it('accepts human principals only', () => {
    expect(isHumanPrincipal({ kind: 'human', method: 'human-token' })).toBe(true);
    expect(isHumanPrincipal({ kind: 'human', method: 'device-token', deviceId: 'd' })).toBe(true);
    expect(isHumanPrincipal({ kind: 'service', method: 'api-token' })).toBe(false);
    expect(isHumanPrincipal({ kind: 'local', method: 'loopback' })).toBe(false);
    expect(isHumanPrincipal({ kind: 'anonymous', method: 'none' })).toBe(false);
  });

  it('is fail-closed for a missing principal', () => {
    expect(isHumanPrincipal(undefined)).toBe(false);
  });
});

describe('humanOnlyDenied', () => {
  it('returns the stable 403 body used by every human-only route', () => {
    expect(humanOnlyDenied()).toEqual({
      status: 403,
      body: { error: 'human principal required', code: 'human_principal_required' },
    });
  });
});
