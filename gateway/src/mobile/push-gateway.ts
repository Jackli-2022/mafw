import { DeviceStore, DeviceEntry, PublicDeviceEntry } from './device-store';
import WebSocket from 'ws';

interface OnlineDevice {
  ws: WebSocket;
  lastSeen: number;
}

export interface BroadcastEvent {
  type: string;
  [key: string]: any;
}

export class PushGateway {
  private store: DeviceStore;
  private onlineDevices: Map<string, OnlineDevice> = new Map();
  private lastGlobalSend: number = 0;
  private readonly globalMinIntervalMs = 1000; // 1 msg/s global rate limit
  private readonly perDeviceMinIntervalMs = 1000; // 1 msg/s per-device rate limit
  private deviceLastSend: Map<string, number> = new Map();

  constructor(store: DeviceStore) {
    this.store = store;
  }

  registerDevice(input: { id: string; fcmToken: string; platform: string; apiTokenHash: string }): DeviceEntry {
    return this.store.register(input);
  }

  /**
   * E5a-3: persist a per-device credential (sha256 only). Re-issuing for the
   * same device rotates the token — the previous one stops verifying.
   */
  issueDeviceToken(
    deviceId: string,
    token: string,
    opts: { platform: string; deviceName?: string; fcmToken?: string },
  ): DeviceEntry {
    return this.store.issueCredential({
      id: deviceId,
      token,
      platform: opts.platform,
      deviceName: opts.deviceName,
      fcmToken: opts.fcmToken,
    });
  }

  /** Verify a presented device token → `{ deviceId }` (transport contract). */
  verifyDeviceToken(token: string): { deviceId: string } | null {
    const entry = this.store.verifyCredential(token);
    return entry ? { deviceId: entry.id } : null;
  }

  /** Clear a device credential without deleting the push registration. */
  revokeDeviceToken(deviceId: string): boolean {
    return this.store.revokeCredential(deviceId);
  }

  listDevices(): DeviceEntry[] {
    return this.store.list();
  }

  /** HTTP-safe projection (no credential hashes). */
  listPublicDevices(): PublicDeviceEntry[] {
    return this.store.listPublic();
  }


  removeDevice(id: string): boolean {
    const ok = this.store.remove(id);
    if (ok) this.removeOnlineWs(id);
    return ok;
  }

  getDevice(id: string): DeviceEntry | undefined {
    return this.store.get(id);
  }

  addOnlineWs(deviceId: string, ws: WebSocket): void {
    this.onlineDevices.set(deviceId, { ws, lastSeen: Date.now() });
    // Sync persisted lastSeen so DeviceStore.pruneStale() doesn't evict active devices.
    this.store.touch(deviceId);
  }

  removeOnlineWs(deviceId: string): void {
    this.onlineDevices.delete(deviceId);
  }

  isOnline(deviceId: string): boolean {
    return this.onlineDevices.has(deviceId);
  }

  setLastSeen(deviceId: string, ts: number): void {
    const entry = this.onlineDevices.get(deviceId);
    if (entry) entry.lastSeen = ts;
  }

  cleanupStale(thresholdMs: number): void {
    const now = Date.now();
    for (const [id, entry] of this.onlineDevices) {
      if (now - entry.lastSeen > thresholdMs) {
        this.onlineDevices.delete(id);
        this.deviceLastSend.delete(id);
      }
    }
  }

  /** Prune registered devices in DeviceStore that haven't been seen since cutoff. */
  pruneDeviceStore(cutoffIso: string): string[] {
    const removed = this.store.pruneStale(cutoffIso);
    // Also clean up any online state for pruned devices.
    for (const id of removed) {
      this.onlineDevices.delete(id);
      this.deviceLastSend.delete(id);
    }
    return removed;
  }

  /**
   * Sync in-memory lastSeen to DeviceStore for all active devices.
   * Call periodically (e.g., every 60s) to prevent pruneDeviceStore()
   * from evicting devices that are actively connected via WS heartbeat.
   */
  syncLastSeenToDeviceStore(): void {
    for (const [id] of this.onlineDevices) {
      this.store.touch(id);
    }
  }

  /**
   * Fan out one broadcast to push-managed devices.
   *
   * E1-7: the mobile transport registers the same socket in `eventHub.wsClients`
   * (primary channel) and here (`onlineDevices`). Callers pass
   * `excludeDeviceIds` = devices already delivered over WS so a device never
   * receives the same event twice (with different timestamps). Omitted ⇒ legacy
   * behaviour (send to every online device). Rate limits are unchanged.
   */
  async onBroadcast(
    event: BroadcastEvent,
    opts?: { excludeDeviceIds?: ReadonlySet<string> },
  ): Promise<void> {
    const now = Date.now();
    const exclude = opts?.excludeDeviceIds;

    // Global leaky bucket: block entire broadcast if last send was <1s ago
    if (now - this.lastGlobalSend < this.globalMinIntervalMs) {
      return;
    }

    const frame = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    let sent = false;

    for (const [deviceId, entry] of this.onlineDevices) {
      // E1-7: WS is the primary channel for connected devices — push is fallback only.
      if (exclude?.has(deviceId)) continue;
      // Per-device rate limit
      const lastSend = this.deviceLastSend.get(deviceId) || 0;
      if (now - lastSend < this.perDeviceMinIntervalMs) {
        continue;
      }

      // 3x exponential backoff on send failure
      let delivered = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (entry.ws.readyState !== WebSocket.OPEN) break;
        try {
          entry.ws.send(frame);
          delivered = true;
          break;
        } catch {
          if (attempt < 2) {
            const delay = Math.pow(2, attempt) * 100; // 100ms, 200ms
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      if (delivered) {
        this.deviceLastSend.set(deviceId, now);
        sent = true;
      } else {
        this.onlineDevices.delete(deviceId);
      }
    }

    if (sent) {
      this.lastGlobalSend = now;
    }
  }

  destroy(): void {
    this.onlineDevices.clear();
    this.deviceLastSend.clear();
  }
}
