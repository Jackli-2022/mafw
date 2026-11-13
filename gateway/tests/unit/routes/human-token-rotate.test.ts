/**
 * E11-1 — human token rotation with live reload.
 *
 * `POST /api/human-token/rotate` is the one credential mutation that must prove
 * possession of the credential it replaces: only a `human` principal resolved
 * from `X-MAFW-Human-Token` may call it. Device tokens authenticate a human on
 * mobile, but rotation is a desktop/CLI operation on the shared file — a device
 * token would let a paired phone silently invalidate the desktop.
 *
 * The tests drive the real catalog + registry handler and derive principals with
 * the real `resolvePrincipal`, so "old token 403 / new token 200" is the actual
 * auth path and not a hand-made principal. The rotate dep mirrors the kernel
 * closure: write atomically, then bind the new value live.
 *
 * Spec: docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md §1.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { humanOnlyDenied, resolvePrincipal, type Principal } from '../../../src/core/auth';
import { humanTokenPath, rotateHumanToken } from '../../../src/core/human-token';
import { attachHumanTokenRoutes } from '../../../src/routes/human-token';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

const HEX64 = /^[0-9a-f]{64}$/;
const URL = '/api/human-token/rotate';
const HUMAN: Principal = { kind: 'human', method: 'human-token' };
const DENIED_BODY = humanOnlyDenied().body;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function mockRes() {
  const res: any = {
    status: 200,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
    setHeader() { return this; },
    get headersSent() { return this.status !== 0; },
  };
  return res as ServerResponse & { status: number; body: string };
}

function mockReq(method: string, principal?: Principal): IncomingMessage {
  const req: any = {
    method,
    url: URL,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on() { /* the rotation route never reads the body */ },
  };
  if (principal) req.mafwPrincipal = principal;
  return req as IncomingMessage;
}

interface Harness {
  dir: string;
  oldToken: string;
  /** Mirrors `kernel.humanToken`: rotation writes the file, then binds live. */
  state: { liveToken: string };
  registry: RouteRegistry;
}

function harness(opts: { rotate?: () => string } = {}): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-e11-rotate-'));
  dirs.push(dir);
  const oldToken = 'a'.repeat(64);
  fs.writeFileSync(humanTokenPath(dir), oldToken, 'utf-8');
  const state = { liveToken: oldToken };
  const registry = new RouteRegistry();
  registry.register(...buildRouteCatalog());
  attachHumanTokenRoutes(registry, {
    rotate: opts.rotate ?? (() => {
      const token = rotateHumanToken(dir);
      state.liveToken = token;
      return token;
    }),
  });
  return { dir, oldToken, state, registry };
}

async function drive(
  registry: RouteRegistry,
  principal?: Principal,
): Promise<{ status: number; json: any }> {
  const matched = registry.match('POST' as never, URL);
  expect(matched?.def.handler).toBeDefined();
  const res = mockRes();
  await Promise.resolve(matched!.def.handler!(mockReq('POST', principal), res, matched!.params));
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

/** A remote (non-loopback) caller: a stale credential must not degrade to `local`. */
function principalFor(headers: Record<string, string>, humanToken: string): Principal {
  return resolvePrincipal(
    { remoteAddress: '203.0.113.9', headers },
    { apiToken: 'service-token', humanToken },
  );
}

describe('POST /api/human-token/rotate', () => {
  it('rotates the file and returns the new credential for a human-token principal', async () => {
    const h = harness();

    const out = await drive(h.registry, HUMAN);

    expect(out.status).toBe(200);
    expect(out.json.token).toMatch(HEX64);
    expect(out.json.token).not.toBe(h.oldToken);
    expect(out.json.token).toBe(h.state.liveToken);
    expect(fs.readFileSync(humanTokenPath(h.dir), 'utf-8').trim()).toBe(out.json.token);
    expect(Number.isNaN(Date.parse(out.json.rotatedAt))).toBe(false);
    expect(Object.keys(out.json).sort()).toEqual(['rotatedAt', 'token']);
    // Atomic write: no `.tmp` leftovers next to the credential.
    expect(fs.readdirSync(h.dir)).toEqual(['human.token']);
  });

  it('invalidates the old token immediately and accepts the new one', async () => {
    const h = harness();

    const before = principalFor({ 'x-mafw-human-token': h.oldToken }, h.state.liveToken);
    expect(before).toEqual(HUMAN);
    expect((await drive(h.registry, before)).status).toBe(200);

    // The gateway re-resolves with the live token (the kernel getter).
    const stale = principalFor({ 'x-mafw-human-token': h.oldToken }, h.state.liveToken);
    const denied = await drive(h.registry, stale);
    expect(denied.status).toBe(403);
    expect(denied.json).toEqual(DENIED_BODY);

    const fresh = principalFor({ 'x-mafw-human-token': h.state.liveToken }, h.state.liveToken);
    expect(fresh).toEqual(HUMAN);
    const previous = h.state.liveToken;
    const admitted = await drive(h.registry, fresh);
    expect(admitted.status).toBe(200);
    expect(admitted.json.token).toMatch(HEX64);
    expect(admitted.json.token).not.toBe(previous);
  });

  describe('denies principals that do not prove possession of the human token', () => {
    const cases: Array<[string, Principal | undefined]> = [
      ['device token', { kind: 'human', method: 'device-token', deviceId: 'dev-1' }],
      ['service api token', { kind: 'service', method: 'api-token' }],
      ['loopback', { kind: 'local', method: 'loopback' }],
      ['anonymous', { kind: 'anonymous', method: 'none' }],
      ['missing principal', undefined],
    ];

    test.each(cases)('%s → 403 with the stable code and no write', async (_label, principal) => {
      const h = harness();

      const out = await drive(h.registry, principal);

      expect(out.status).toBe(403);
      expect(out.json).toEqual(DENIED_BODY);
      // Untouched on disk and in memory: a denial must never burn the credential.
      expect(fs.readFileSync(humanTokenPath(h.dir), 'utf-8').trim()).toBe(h.oldToken);
      expect(h.state.liveToken).toBe(h.oldToken);
    });
  });

  it('returns 500 and keeps the old credential usable when the write fails', async () => {
    const h = harness({
      rotate: () => { throw new Error('EACCES: permission denied, open human.token'); },
    });

    const out = await drive(h.registry, HUMAN);

    expect(out.status).toBe(500);
    expect(out.json).toEqual({ error: 'EACCES: permission denied, open human.token' });
    // The failure body never carries a credential.
    expect(JSON.stringify(out.json)).not.toMatch(/[0-9a-f]{64}/);
    expect(fs.readFileSync(humanTokenPath(h.dir), 'utf-8').trim()).toBe(h.oldToken);
    // Live binding untouched → the old token still resolves as human.
    expect(h.state.liveToken).toBe(h.oldToken);
    expect(principalFor({ 'x-mafw-human-token': h.oldToken }, h.state.liveToken)).toEqual(HUMAN);
    const retry = await drive(h.registry, HUMAN);
    expect(retry.status).toBe(500);
  });

  it('is POST-only (GET is not routed)', () => {
    const h = harness();
    expect(h.registry.match('POST' as never, URL)?.def.operationId).toBe('humanToken.rotate');
    expect(h.registry.match('GET' as never, URL)).toBeNull();
  });

  it('is not a human-only bypass for other principals when the token file is malformed', () => {
    // Fail-closed: an empty live token never matches, even with a 64-hex header.
    const principal = resolvePrincipal(
      { remoteAddress: '203.0.113.9', headers: { 'x-mafw-human-token': 'b'.repeat(64) } },
      { apiToken: 'service-token', humanToken: '' },
    );
    expect(principal.kind).not.toBe('human');
  });
});

// ---------------------------------------------------------------------------
// Guard rails for the two surfaces that must never print the credential
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

describe('rotation logging / CLI hygiene', () => {
  it('the kernel logs a constant message and never the rotated token', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'gateway', 'src', 'kernel.ts'), 'utf-8');
    const lines = src.split(/\r?\n/).filter((line) => line.includes('human token rotated'));

    expect(lines).toHaveLength(1);
    expect(lines[0].trim()).toBe("log.warn('[Auth] human token rotated');");
  });

  it('the CLI registers `rotate-human-token` and never prints the new token', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'bin', 'mafw.js'), 'utf-8');

    expect(src).toContain("'rotate-human-token'");
    expect(src).toContain('rotate-human-token');

    const start = src.indexOf('async function runHumanTokenRotation');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\nfunction ', start);
    const body = src.slice(start, end === -1 ? undefined : end);
    // Possession proof + status/timestamp only.
    expect(body).toContain('X-MAFW-Human-Token');
    expect(body).toContain('rotatedAt');
    expect(body).not.toMatch(/body\.token/);
    expect(body).not.toMatch(/console\.(log|error)\([^\n]*res\.body/);
  });
});
