import * as fs from 'fs';
import * as path from 'path';

export interface DeviceEntry {
  id: string;
  fcmToken: string;
  platform: string;
  lastSeen: string;
  apiTokenHash: string;
}

export interface DeviceStoreFile {
  devices: DeviceEntry[];
}

const MAX_DEVICES = 600;

export class DeviceStore {
  private filePath: string;
  private devices: Map<string, DeviceEntry> = new Map();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: DeviceStoreFile = JSON.parse(raw);
        for (const d of data.devices || []) {
          this.devices.set(d.id, d);
        }
      }
    } catch {
      // Corrupted file — start fresh
      this.devices.clear();
    }
  }

  private save(): void {
    const data: DeviceStoreFile = {
      devices: Array.from(this.devices.values()),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows: no POSIX perms */ }
  }

  register(input: { id: string; fcmToken: string; platform: string; apiTokenHash: string }): DeviceEntry {
    if (!this.devices.has(input.id) && this.devices.size >= MAX_DEVICES) {
      throw new Error(`Device limit reached (${MAX_DEVICES})`);
    }
    const entry: DeviceEntry = {
      id: input.id,
      fcmToken: input.fcmToken,
      platform: input.platform,
      apiTokenHash: input.apiTokenHash,
      lastSeen: new Date().toISOString(),
    };
    this.devices.set(input.id, entry);
    this.save();
    return entry;
  }

  get(id: string): DeviceEntry | undefined {
    return this.devices.get(id);
  }

  list(): DeviceEntry[] {
    return Array.from(this.devices.values());
  }

  remove(id: string): boolean {
    const existed = this.devices.delete(id);
    if (existed) this.save();
    return existed;
  }
}
