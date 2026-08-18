import { DeviceStore, DeviceEntry } from './device-store';
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
  private readonly msgPerSecLimit = 1000; // 1 msg/s global
  private readonly perDeviceLimit = 1000; // 1 msg/s per device
  private deviceLastSend: Map<string, number> = new Map();

  constructor(store: DeviceStore) {
    this.store = store;
  }

  registerDevice(input: { id: string; fcmToken: string; platform: string; apiTokenHash: string }): DeviceEntry {
    return this.store.register(input);
  }

  addOnlineWs(deviceId: string, ws: WebSocket): void {
    this.onlineDevices.set(deviceId, { ws, lastSeen: Date.now() });
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
      }
    }
  }

  async onBroadcast(event: BroadcastEvent): Promise<void> {
    const now = Date.now();

    // Global leaky bucket: block entire broadcast if last send was <1s ago
    if (now - this.lastGlobalSend < this.msgPerSecLimit) {
      return;
    }

    const frame = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    let sent = false;

    for (const [deviceId, entry] of this.onlineDevices) {
      // Per-device rate limit
      const lastSend = this.deviceLastSend.get(deviceId) || 0;
      if (now - lastSend < this.perDeviceLimit) {
        continue;
      }

      if (entry.ws.readyState === WebSocket.OPEN) {
        try {
          entry.ws.send(frame);
          this.deviceLastSend.set(deviceId, now);
          sent = true;
        } catch {
          this.onlineDevices.delete(deviceId);
        }
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
