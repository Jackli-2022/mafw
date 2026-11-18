import * as crypto from 'node:crypto';
import { hashSecret } from './room.ts';

export interface RoomClaimInput {
  roomId: string;
  roomToken: string;
  routeSecret: string;
}

export interface RoomClaim {
  roomId: string;
  createdAt: number;
  lastSeenAt: number;
  hostConnectionId?: string;
}

interface RoomRecord extends RoomClaim {
  tokenHash: string;
  routeSecretHash: string;
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function publicClaim(record: RoomRecord): RoomClaim {
  return {
    roomId: record.roomId,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    hostConnectionId: record.hostConnectionId,
  };
}

/**
 * M1: in-memory room claims. SQLite persistence lands with the deploy milestone.
 * Claims are never dropped by idleness: only an explicit release removes one.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, RoomRecord>();

  claim(input: RoomClaimInput, now = Date.now()): RoomClaim | null {
    const tokenHash = hashSecret(input.roomToken);
    const existing = this.rooms.get(input.roomId);
    if (existing) {
      if (!sameHex(existing.tokenHash, tokenHash)) return null;
      existing.lastSeenAt = now;
      return publicClaim(existing);
    }

    const record: RoomRecord = {
      roomId: input.roomId,
      createdAt: now,
      lastSeenAt: now,
      tokenHash,
      routeSecretHash: hashSecret(input.routeSecret),
    };
    this.rooms.set(input.roomId, record);
    return publicClaim(record);
  }

  authenticate(roomId: string, roomToken: string, routeSecret?: string, now = Date.now()): RoomClaim | null {
    const record = this.rooms.get(roomId);
    if (!record) return null;
    if (!sameHex(record.tokenHash, hashSecret(roomToken))) return null;
    if (routeSecret !== undefined && !sameHex(record.routeSecretHash, hashSecret(routeSecret))) return null;
    record.lastSeenAt = now;
    return publicClaim(record);
  }

  attachHost(roomId: string, connectionId: string): { ok: boolean; replaced?: string } {
    const record = this.rooms.get(roomId);
    if (!record) return { ok: false };
    const replaced = record.hostConnectionId;
    record.hostConnectionId = connectionId;
    return replaced && replaced !== connectionId ? { ok: true, replaced } : { ok: true };
  }

  detachHost(roomId: string, connectionId: string): void {
    const record = this.rooms.get(roomId);
    if (record?.hostConnectionId === connectionId) delete record.hostConnectionId;
  }

  get(roomId: string): RoomClaim | undefined {
    const record = this.rooms.get(roomId);
    return record ? publicClaim(record) : undefined;
  }

  online(roomId: string): boolean {
    return Boolean(this.rooms.get(roomId)?.hostConnectionId);
  }

  routeSecretMatches(roomId: string, routeSecret: string): boolean {
    const record = this.rooms.get(roomId);
    return Boolean(record && sameHex(record.routeSecretHash, hashSecret(routeSecret)));
  }

  release(roomId: string): void {
    this.rooms.delete(roomId);
  }
}
