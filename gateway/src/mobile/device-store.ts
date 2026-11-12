import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface DeviceEntry {
  id: string;
  fcmToken: string;
  platform: string;
  lastSeen: string;
  apiTokenHash: string;
  /** Optional human-readable label from the pairing request. */
  deviceName?: string;
  /**
   * sha256(device token) hex — the only at-rest form of a per-device
   * credential. Absent for legacy records and after revocation.
   */
  deviceTokenHash?: string;
  /** ISO timestamp when the current credential was issued (rotation marker). */
  tokenIssuedAt?: string;
}

/** Wire/public projection: credential hashes never leave the gateway. */
export type PublicDeviceEntry = Omit<DeviceEntry, 'deviceTokenHash' | 'apiTokenHash'>;

export interface DeviceStoreFile {
  devices: DeviceEntry[];
}

export const MAX_DEVICES = 600;

/** F8 input bounds for per-device credentials (route pre-validates → 400). */
export const DEVICE_ID_MAX_LENGTH = 128;
export const DEVICE_NAME_MAX_LENGTH = 100;
export const PLATFORM_MAX_LENGTH = 40;
const DEVICE_ID_RE = /^[A-Za-z0-9._:-]+$/;

/** Persist credential-use lastSeen at most once per hour (F7). */
const CREDENTIAL_TOUCH_PERSIST_MS = 60 * 60 * 1000;

/**
 * Validate credential input before any nonce consumption / store write.
 * Returns a human-readable error (route → 400) or null when valid.
 */
export function validateDeviceCredentialInput(input: {
  id: string;
  platform?: string;
  deviceName?: string;
}): string | null {
  if (!input.id || input.id.length > DEVICE_ID_MAX_LENGTH || !DEVICE_ID_RE.test(input.id)) {
    return `invalid deviceId (max ${DEVICE_ID_MAX_LENGTH} chars of A-Z a-z 0-9 . _ : -)`;
  }
  if (input.platform !== undefined && input.platform.length > PLATFORM_MAX_LENGTH) {
    return `platform too long (max ${PLATFORM_MAX_LENGTH} chars)`;
  }
  if (input.deviceName !== undefined && input.deviceName.length > DEVICE_NAME_MAX_LENGTH) {
    return `deviceName too long (max ${DEVICE_NAME_MAX_LENGTH} chars)`;
  }
  return null;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare of two hex digests (length-guarded, never throws). */
function hashEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** Strip credential material before it leaves the gateway (HTTP responses/logs). */
export function toPublicDevice(entry: DeviceEntry): PublicDeviceEntry {
  const { deviceTokenHash: _deviceTokenHash, apiTokenHash: _apiTokenHash, ...rest } = entry;
  return rest;
}

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
          // Tolerate records written before the newer fields existed (and any
          // partially-written entry): only the missing fields are normalized.
          const entry: DeviceEntry = {
            ...d,
            fcmToken: typeof d.fcmToken === 'string' ? d.fcmToken : '',
            apiTokenHash: typeof d.apiTokenHash === 'string' ? d.apiTokenHash : '',
          };
          if (typeof d.deviceTokenHash === 'string' && d.deviceTokenHash) {
            entry.deviceTokenHash = d.deviceTokenHash;
          } else {
            delete entry.deviceTokenHash;
          }
          if (typeof d.tokenIssuedAt === 'string' && d.tokenIssuedAt) {
            entry.tokenIssuedAt = d.tokenIssuedAt;
          } else {
            delete entry.tokenIssuedAt;
          }
          if (d.deviceName !== undefined && typeof d.deviceName !== 'string') {
            delete entry.deviceName;
          }
          this.devices.set(d.id, entry);
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
    const existing = this.devices.get(input.id);
    if (!existing && this.devices.size >= MAX_DEVICES) {
      throw new Error(`Device limit reached (${MAX_DEVICES})`);
    }
    const entry: DeviceEntry = {
      id: input.id,
      // `fcmToken` is the FCM push token supplied by the device (mobile client
      // sends it in `body.token`). It is NOT a gateway credential — the bearer
      // token only ever travels in the Authorization header.
      fcmToken: input.fcmToken,
      platform: input.platform,
      apiTokenHash: input.apiTokenHash,
      lastSeen: new Date().toISOString(),
    };
    // E5a-3: a push re-registration must NOT revoke the device credential.
    if (existing?.deviceName !== undefined) entry.deviceName = existing.deviceName;
    if (existing?.deviceTokenHash) entry.deviceTokenHash = existing.deviceTokenHash;
    if (existing?.tokenIssuedAt) entry.tokenIssuedAt = existing.tokenIssuedAt;
    this.devices.set(input.id, entry);
    this.save();
    return entry;
  }

  /**
   * Issue (or rotate) a per-device credential. Only sha256(token) is persisted.
   * `id` is the stable device id from pairing; re-issuing replaces the previous
   * credential (old token stops verifying immediately).
   */
  issueCredential(input: {
    id: string;
    token: string;
    platform?: string;
    deviceName?: string;
    fcmToken?: string;
  }): DeviceEntry {
    const invalid = validateDeviceCredentialInput(input);
    if (invalid) throw new Error(invalid);
    if (!input.token) throw new Error('Device token required');
    const existing = this.devices.get(input.id);
    if (!existing && this.devices.size >= MAX_DEVICES) {
      throw new Error(`Device limit reached (${MAX_DEVICES})`);
    }
    // F8: an omitted platform keeps the existing one (no clobber to 'unknown').
    const platform = input.platform || existing?.platform || 'unknown';
    const now = new Date().toISOString();
    const entry: DeviceEntry = {
      ...(existing ?? {
        id: input.id,
        fcmToken: '',
        platform,
        apiTokenHash: '',
        lastSeen: now,
      }),
      id: input.id,
      platform,
      lastSeen: now,
      deviceTokenHash: sha256Hex(input.token),
      tokenIssuedAt: now,
    };
    if (input.fcmToken !== undefined) entry.fcmToken = input.fcmToken;
    if (input.deviceName !== undefined) entry.deviceName = input.deviceName;
    this.devices.set(input.id, entry);
    this.save();
    return entry;
  }

  /** Verify a presented device token against the stored hash. */
  verifyCredential(token: string): DeviceEntry | null {
    if (!token) return null;
    const hash = sha256Hex(token);
    for (const entry of this.devices.values()) {
      if (entry.deviceTokenHash && hashEquals(entry.deviceTokenHash, hash)) {
        this.touchCredentialUse(entry);
        return entry;
      }
    }
    return null;
  }

  /**
   * F7: credential use counts as activity (REST-only devices must not be pruned
   * after 7 days), but the file write is throttled to once per hour so a busy
   * client does not rewrite the store on every request.
   */
  private touchCredentialUse(entry: DeviceEntry): void {
    const now = Date.now();
    const lastMs = Date.parse(entry.lastSeen);
    entry.lastSeen = new Date(now).toISOString();
    if (!Number.isFinite(lastMs) || now - lastMs > CREDENTIAL_TOUCH_PERSIST_MS) {
      this.save();
    }
  }

  /**
   * Clear the device credential but keep the entry (push registration stays
   * valid). Device deletion is the hard revocation — `remove()`.
   */
  revokeCredential(id: string): boolean {
    const entry = this.devices.get(id);
    if (!entry) return false;
    delete entry.deviceTokenHash;
    delete entry.tokenIssuedAt;
    this.save();
    return true;
  }

  get(id: string): DeviceEntry | undefined {
    return this.devices.get(id);
  }

  list(): DeviceEntry[] {
    return Array.from(this.devices.values());
  }

  /** Sanitized list for HTTP responses (no credential hashes). */
  listPublic(): PublicDeviceEntry[] {
    return this.list().map(toPublicDevice);
  }

  remove(id: string): boolean {
    const existed = this.devices.delete(id);
    if (existed) this.save();
    return existed;
  }

  /** Update lastSeen timestamp for an existing device (WS connect / heartbeat). */
  touch(id: string): boolean {
    const entry = this.devices.get(id);
    if (!entry) return false;
    entry.lastSeen = new Date().toISOString();
    this.save();
    return true;
  }

  /** Remove devices not seen since cutoff (ISO string). Returns removed IDs. */
  pruneStale(cutoffIso: string): string[] {
    const removed: string[] = [];
    for (const [id, entry] of this.devices) {
      if (entry.lastSeen < cutoffIso) {
        this.devices.delete(id);
        removed.push(id);
      }
    }
    if (removed.length > 0) this.save();
    return removed;
  }
}
