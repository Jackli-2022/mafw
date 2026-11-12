/**
 * Human token — the credential that distinguishes the OS user (a human) from
 * gateway services (agents, MCP, automations) for human-only actions.
 *
 * Location: `<data root>/human.token` (fixed; see spec §3.1). The file is the
 * single source of truth: desktop/TUI read it in their main process and inject
 * it as `X-MAFW-Human-Token`.
 *
 * Hygiene:
 *   - 32 random bytes as lowercase hex (64 chars)
 *   - atomic write (`.tmp` + rename) so a crash never leaves a truncated token
 *   - POSIX 0600 best-effort; Windows relies on the per-user directory ACL
 *   - unreadable/unwritable → throws; the kernel logs and stays fail-closed
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const HUMAN_TOKEN_FILE = 'human.token';
const HUMAN_TOKEN_RE = /^[0-9a-f]{64}$/;

export const HUMAN_TOKEN_FILENAME = HUMAN_TOKEN_FILE;

export function humanTokenPath(dir: string): string {
  return path.join(dir, HUMAN_TOKEN_FILE);
}

/**
 * Load the human token from `dir`, creating (or regenerating a malformed)
 * `human.token` atomically. Throws only when the file cannot be written —
 * callers treat that as "no human credential available" (fail-closed).
 */
export function loadOrCreateHumanToken(dir: string): string {
  const file = humanTokenPath(dir);

  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (isWellFormed(existing)) return existing;
  } catch {
    // Missing / unreadable → fall through and try to (re)create.
  }

  const token = crypto.randomBytes(32).toString('hex');
  writeTokenAtomically(file, token);
  return token;
}

export function isWellFormedHumanToken(value: string): boolean {
  return isWellFormed(value);
}

function isWellFormed(value: string): boolean {
  return HUMAN_TOKEN_RE.test(value);
}

function writeTokenAtomically(file: string, token: string): void {
  // The kernel may call this before anything else created the data root
  // (fresh install / wiped ~/.mafw), so create it first.
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    const buf = Buffer.from(token, 'utf-8');
    let written = 0;
    while (written < buf.length) {
      written += fs.writeSync(fd, buf, written, buf.length - written);
    }
    // Durability: the rename is only meaningful once the bytes hit the disk.
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* best effort: never mask the real error */ }
    throw err;
  }
  // rename keeps the temp file's mode on POSIX, but be explicit (best-effort;
  // Windows has no POSIX permission bits and relies on directory ACLs).
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
}
