/**
 * E5a-1 — human token file lifecycle.
 *
 * The human token is the only credential that may perform human-only actions.
 * These tests pin the on-disk contract: fixed data-root filename, 64 lowercase
 * hex chars, stable across calls, atomic write (no leftover temp files) and
 * malformed-file regeneration.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadOrCreateHumanToken, rotateHumanToken } from '../../../src/core/human-token';

const HEX64 = /^[0-9a-f]{64}$/;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-human-token-'));
}

const dirs: string[] = [];

function trackDir(): string {
  const dir = tempDir();
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('loadOrCreateHumanToken', () => {
  it('creates ~/.mafw/human.token on first call with 64 hex chars', () => {
    const dir = trackDir();
    const token = loadOrCreateHumanToken(dir);

    expect(token).toMatch(HEX64);
    expect(fs.readFileSync(path.join(dir, 'human.token'), 'utf-8').trim()).toBe(token);
  });

  it('returns the same token on subsequent calls (stable identity)', () => {
    const dir = trackDir();
    const first = loadOrCreateHumanToken(dir);
    const second = loadOrCreateHumanToken(dir);

    expect(second).toBe(first);
  });

  it('trims surrounding whitespace from an existing valid token', () => {
    const dir = trackDir();
    const token = 'b'.repeat(64);
    fs.writeFileSync(path.join(dir, 'human.token'), `  ${token}\r\n`, 'utf-8');

    expect(loadOrCreateHumanToken(dir)).toBe(token);
  });

  it('leaves no temporary files behind (atomic .tmp + rename)', () => {
    const dir = trackDir();
    loadOrCreateHumanToken(dir);

    expect(fs.readdirSync(dir)).toEqual(['human.token']);
  });

  it('regenerates a malformed token file', () => {
    const dir = trackDir();
    fs.writeFileSync(path.join(dir, 'human.token'), 'not-a-token', 'utf-8');

    const token = loadOrCreateHumanToken(dir);

    expect(token).toMatch(HEX64);
    expect(token).not.toBe('not-a-token');
    expect(fs.readFileSync(path.join(dir, 'human.token'), 'utf-8').trim()).toBe(token);
  });

  it('regenerates an empty token file (empty never authenticates)', () => {
    const dir = trackDir();
    fs.writeFileSync(path.join(dir, 'human.token'), '   \n', 'utf-8');

    expect(loadOrCreateHumanToken(dir)).toMatch(HEX64);
  });

  it('regenerates a token of the wrong length or character class', () => {
    const dir = trackDir();
    fs.writeFileSync(path.join(dir, 'human.token'), 'z'.repeat(64), 'utf-8');
    expect(loadOrCreateHumanToken(dir)).toMatch(HEX64);

    fs.writeFileSync(path.join(dir, 'human.token'), 'a'.repeat(63), 'utf-8');
    expect(loadOrCreateHumanToken(dir)).toMatch(HEX64);
  });

  const posixOnly = process.platform === 'win32' ? it.skip : it;
  posixOnly('restricts the token file to 0600 on POSIX', () => {
    const dir = trackDir();
    loadOrCreateHumanToken(dir);

    const mode = fs.statSync(path.join(dir, 'human.token')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('creates the data root before writing (virgin nested directory)', () => {
    const root = trackDir();
    const dir = path.join(root, 'nested', 'mafw');

    const token = loadOrCreateHumanToken(dir);

    expect(token).toMatch(HEX64);
    expect(fs.readFileSync(path.join(dir, 'human.token'), 'utf-8').trim()).toBe(token);
    expect(fs.readdirSync(dir)).toEqual(['human.token']);
  });
});

// ---------------------------------------------------------------------------
// E11-1: rotation
// ---------------------------------------------------------------------------

describe('rotateHumanToken', () => {
  it('replaces the on-disk token with a fresh well-formed one', () => {
    const dir = trackDir();
    const before = loadOrCreateHumanToken(dir);

    const rotated = rotateHumanToken(dir);

    expect(rotated).toMatch(HEX64);
    expect(rotated).not.toBe(before);
    expect(fs.readFileSync(path.join(dir, 'human.token'), 'utf-8').trim()).toBe(rotated);
    // The loader now returns the rotated credential, not the old one.
    expect(loadOrCreateHumanToken(dir)).toBe(rotated);
  });

  it('rotates again on every call (no accidental idempotence)', () => {
    const dir = trackDir();
    const first = rotateHumanToken(dir);
    const second = rotateHumanToken(dir);

    expect(second).not.toBe(first);
    expect(fs.readFileSync(path.join(dir, 'human.token'), 'utf-8').trim()).toBe(second);
  });

  it('creates the data root when rotating in a virgin directory', () => {
    const dir = path.join(trackDir(), 'nested', 'mafw');

    const token = rotateHumanToken(dir);

    expect(token).toMatch(HEX64);
    expect(fs.readFileSync(path.join(dir, 'human.token'), 'utf-8').trim()).toBe(token);
    expect(fs.readdirSync(dir)).toEqual(['human.token']);
  });

  it('leaves no temporary files behind', () => {
    const dir = trackDir();
    rotateHumanToken(dir);

    expect(fs.readdirSync(dir)).toEqual(['human.token']);
  });

  it('throws and cleans up its temp file when the target cannot be replaced', () => {
    const dir = trackDir();
    // `human.token` as a non-empty directory: the atomic rename can never
    // replace it on Windows or POSIX, so the failure path must surface.
    fs.mkdirSync(path.join(dir, 'human.token', 'occupant'), { recursive: true });

    expect(() => rotateHumanToken(dir)).toThrow();

    // The interrupted write leaves no `.tmp` debris behind.
    expect(fs.readdirSync(dir)).toEqual(['human.token']);
    expect(fs.existsSync(path.join(dir, 'human.token', 'occupant'))).toBe(true);
  });

  const posixOnly = process.platform === 'win32' ? it.skip : it;
  posixOnly('keeps the rotated file at 0600 on POSIX', () => {
    const dir = trackDir();
    loadOrCreateHumanToken(dir);
    rotateHumanToken(dir);

    expect(fs.statSync(path.join(dir, 'human.token')).mode & 0o777).toBe(0o600);
  });
});
