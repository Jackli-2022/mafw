import * as crypto from 'node:crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const ROOM_PART_RE = /^[a-z2-7]{26}$/;

function base32(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function newRoomId(): string {
  return base32(crypto.randomBytes(16));
}

export function newRouteSecret(): string {
  return base32(crypto.randomBytes(16));
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export interface RoomIdentity {
  roomId: string;
  routeSecret: string;
}

/**
 * Parses the exact SNI form `<roomId>-<routeSecret>.<domain>`.
 * Rejects extra labels, uppercase, encoded separators and traversal.
 */
export function parseRoomHost(host: string, domain: string): RoomIdentity | null {
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  if (label.includes('%') || label.includes('\\') || label.includes('..')) return null;

  const parts = label.split('-');
  if (parts.length !== 2) return null;
  const [roomId, routeSecret] = parts;
  if (!ROOM_PART_RE.test(roomId) || !ROOM_PART_RE.test(routeSecret)) return null;
  return { roomId, routeSecret };
}
