import * as fs from 'node:fs';
import * as path from 'node:path';

export interface StoredRoom {
  roomId: string;
  tokenHash: string;
  routeSecretHash: string;
  createdAt: number;
  lastSeenAt: number;
  hostConnectionId?: string;
}

export interface RoomStore {
  load(): StoredRoom[];
  save(room: StoredRoom): void;
  delete(roomId: string): void;
  close?(): void;
}

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, StoredRoom>();

  load(): StoredRoom[] {
    return [...this.rooms.values()].map((room) => ({ ...room }));
  }

  save(room: StoredRoom): void {
    this.rooms.set(room.roomId, { ...room });
  }

  delete(roomId: string): void {
    this.rooms.delete(roomId);
  }
}

/**
 * M4: durable room claims. `node:sqlite` is a built-in (Node 22.5+), so the
 * relay needs no native dependency; the production image mounts /data.
 */
export class SqliteRoomStore implements RoomStore {
  private readonly db: any;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sqlite = (process as any).getBuiltinModule?.('node:sqlite');
    if (!sqlite?.DatabaseSync) {
      throw new Error('node:sqlite is unavailable (requires Node 22.5+)');
    }
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        route_secret_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        host_connection_id TEXT
      )
    `);
  }

  load(): StoredRoom[] {
    return this.db.prepare('SELECT * FROM rooms').all().map((row: any) => ({
      roomId: row.room_id,
      tokenHash: row.token_hash,
      routeSecretHash: row.route_secret_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      hostConnectionId: row.host_connection_id ?? undefined,
    }));
  }

  save(room: StoredRoom): void {
    this.db.prepare(`
      INSERT INTO rooms
        (room_id, token_hash, route_secret_hash, created_at, last_seen_at, host_connection_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        route_secret_hash = excluded.route_secret_hash,
        last_seen_at = excluded.last_seen_at,
        host_connection_id = excluded.host_connection_id
    `).run(
      room.roomId,
      room.tokenHash,
      room.routeSecretHash,
      room.createdAt,
      room.lastSeenAt,
      room.hostConnectionId ?? null,
    );
  }

  delete(roomId: string): void {
    this.db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId);
  }

  close(): void {
    this.db.close();
  }
}
