/**
 * E5a-3 — per-device credentials in DeviceStore / PushGateway.
 *
 * Contract (spec §3.2):
 *   - `deviceTokenHash = sha256(token)` at rest; the plaintext token never
 *     touches the store file.
 *   - Pairing re-issues (rotation) replace the hash → the old token dies.
 *   - Push re-registration (`register`) must PRESERVE the credential; a push
 *     refresh must not silently revoke the device.
 *   - `remove()` deletes the entry (= revocation); `revokeCredential()` only
 *     clears the credential for rotation-by-pairing while keeping push state.
 *   - list projections never leak `deviceTokenHash` / `apiTokenHash`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { DeviceStore, toPublicDevice } from '../../../src/mobile/device-store';
import { PushGateway } from '../../../src/mobile/push-gateway';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function tmpStoreFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-device-cred-'));
  return path.join(dir, 'mobile-devices.json');
}

describe('DeviceStore credentials (E5a-3)', () => {
  let file: string;
  let store: DeviceStore;

  beforeEach(() => {
    file = tmpStoreFile();
    store = new DeviceStore(file);
  });

  it('issueCredential stores sha256(token) + tokenIssuedAt and no plaintext', () => {
    const token = 'dev_TESTSECRETVALUE1234567890abc';
    const entry = store.issueCredential({
      id: 'phone-1',
      token,
      platform: 'android',
      deviceName: 'Pixel',
    });

    expect(entry.id).toBe('phone-1');
    expect(entry.deviceTokenHash).toBe(sha256(token));
    expect(entry.tokenIssuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.platform).toBe('android');
    expect(entry.deviceName).toBe('Pixel');

    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toContain(sha256(token));
    expect(raw).not.toContain(token);
  });

  it('verifyCredential matches only the issued token', () => {
    const token = 'dev_right_token_abcdefghijklmnop';
    store.issueCredential({ id: 'phone-1', token, platform: 'android' });

    expect(store.verifyCredential(token)?.id).toBe('phone-1');
    expect(store.verifyCredential('dev_wrong_token_abcdefghijklmnop')).toBeNull();
    expect(store.verifyCredential('')).toBeNull();
  });

  it('re-issuing rotates the credential: old token stops working immediately', () => {
    const first = 'dev_first_token_abcdefghijklmnop';
    const second = 'dev_second_token_abcdefghijklmnop';
    store.issueCredential({ id: 'phone-1', token: first, platform: 'android' });
    const firstIssuedAt = store.get('phone-1')!.tokenIssuedAt;

    store.issueCredential({ id: 'phone-1', token: second, platform: 'android' });

    expect(store.verifyCredential(first)).toBeNull();
    expect(store.verifyCredential(second)?.id).toBe('phone-1');
    expect(store.get('phone-1')!.deviceTokenHash).toBe(sha256(second));
    // Rotation is an update, not a new device.
    expect(store.list()).toHaveLength(1);
    expect(store.get('phone-1')!.tokenIssuedAt! >= firstIssuedAt!).toBe(true);
  });

  it('register (push re-register) preserves the existing credential', () => {
    const token = 'dev_keep_me_token_abcdefghijklmnop';
    store.issueCredential({ id: 'phone-1', token, platform: 'android', fcmToken: 'fcm-old' });
    const hashBefore = store.get('phone-1')!.deviceTokenHash;
    const issuedBefore = store.get('phone-1')!.tokenIssuedAt;

    store.register({
      id: 'phone-1',
      fcmToken: 'fcm-new',
      platform: 'android',
      apiTokenHash: 'push-hash',
    });

    const entry = store.get('phone-1')!;
    expect(entry.deviceTokenHash).toBe(hashBefore);
    expect(entry.tokenIssuedAt).toBe(issuedBefore);
    expect(entry.fcmToken).toBe('fcm-new');
    expect(entry.apiTokenHash).toBe('push-hash');
    expect(store.verifyCredential(token)?.id).toBe('phone-1');
  });

  it('revokeCredential clears the token but keeps the device for push', () => {
    const token = 'dev_revoke_me_token_abcdefghijkl';
    store.issueCredential({ id: 'phone-1', token, platform: 'android', fcmToken: 'fcm-1' });

    expect(store.revokeCredential('phone-1')).toBe(true);

    const entry = store.get('phone-1')!;
    expect(entry).toBeDefined();
    expect(entry.deviceTokenHash).toBeUndefined();
    expect(entry.tokenIssuedAt).toBeUndefined();
    expect(entry.fcmToken).toBe('fcm-1');
    expect(store.verifyCredential(token)).toBeNull();
    expect(store.revokeCredential('missing')).toBe(false);
  });

  it('remove() deletes the entry, which revokes the credential', () => {
    const token = 'dev_delete_me_token_abcdefghijkl';
    store.issueCredential({ id: 'phone-1', token, platform: 'android' });

    expect(store.remove('phone-1')).toBe(true);
    expect(store.verifyCredential(token)).toBeNull();
    expect(store.get('phone-1')).toBeUndefined();
  });

  it('enforces MAX_DEVICES for new devices but allows rotating an existing one', () => {
    for (let i = 0; i < 600; i++) {
      store.issueCredential({ id: `dev-${i}`, token: `dev_tok_${i}_abcdefghijklmnop`, platform: 'android' });
    }

    expect(() =>
      store.issueCredential({ id: 'dev-overflow', token: 'dev_overflow_token_abcdefghijkl', platform: 'android' }),
    ).toThrow(/Device limit reached/);

    expect(() =>
      store.issueCredential({ id: 'dev-0', token: 'dev_rotated_token_abcdefghijkl', platform: 'android' }),
    ).not.toThrow();
  });

  it('keeps legacy records (no deviceTokenHash) loadable and listable', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      devices: [
        { id: 'legacy-1', fcmToken: 'legacy-fcm', platform: 'android', lastSeen: '2026-01-01T00:00:00.000Z' },
      ],
    }), 'utf8');

    const legacyStore = new DeviceStore(file);
    expect(legacyStore.list()).toHaveLength(1);
    expect(legacyStore.get('legacy-1')!.deviceTokenHash).toBeUndefined();
    expect(legacyStore.verifyCredential('anything')).toBeNull();
    expect(legacyStore.listPublic()[0]).toMatchObject({ id: 'legacy-1', fcmToken: 'legacy-fcm' });
  });

  it('credential survives a reload', () => {
    const token = 'dev_persist_token_abcdefghijklmnop';
    store.issueCredential({ id: 'phone-1', token, platform: 'ios' });

    const reloaded = new DeviceStore(file);
    expect(reloaded.verifyCredential(token)?.id).toBe('phone-1');
    expect(reloaded.get('phone-1')!.tokenIssuedAt).toBeTruthy();
  });

  it('public projection strips both credential hashes', () => {
    store.register({ id: 'phone-1', fcmToken: 'fcm', platform: 'android', apiTokenHash: 'push-hash' });
    store.issueCredential({ id: 'phone-1', token: 'dev_public_proj_token_abcdefghij', platform: 'android' });

    const publicEntry = toPublicDevice(store.get('phone-1')!);
    expect(publicEntry).not.toHaveProperty('deviceTokenHash');
    expect(publicEntry).not.toHaveProperty('apiTokenHash');
    expect(publicEntry).toMatchObject({ id: 'phone-1', fcmToken: 'fcm', platform: 'android' });

    for (const entry of store.listPublic()) {
      expect(entry).not.toHaveProperty('deviceTokenHash');
      expect(entry).not.toHaveProperty('apiTokenHash');
    }
  });

  // F7: REST-only devices stay alive; credential use refreshes lastSeen and
  // persists at most once per hour (no file write per request).
  it('verifyCredential refreshes lastSeen and persists at most hourly (F7)', () => {
    const token = 'dev_lastseen_token_abcdefghijklmn';
    store.issueCredential({ id: 'phone-1', token, platform: 'android' });
    const issuedSeen = store.get('phone-1')!.lastSeen;
    const diskLastSeen = () => JSON.parse(fs.readFileSync(file, 'utf8')).devices[0].lastSeen;

    const start = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start + 30 * 60_000);
    expect(store.verifyCredential(token)).not.toBeNull();
    expect(store.get('phone-1')!.lastSeen > issuedSeen).toBe(true);
    // In-memory refresh only — the file is untouched inside the hour.
    expect(diskLastSeen()).toBe(issuedSeen);

    // Same hour: still no persist.
    nowSpy.mockReturnValue(start + 45 * 60_000);
    store.verifyCredential(token);
    expect(diskLastSeen()).toBe(issuedSeen);

    // More than an hour since the last persisted lastSeen → persist once.
    const persistedAt = start + 2 * 60 * 60_000;
    nowSpy.mockReturnValue(persistedAt);
    store.verifyCredential(token);
    expect(diskLastSeen()).toBe(new Date(persistedAt).toISOString());

    // Immediate repeat after the write → no second write (disk unchanged).
    nowSpy.mockReturnValue(persistedAt + 1_000);
    store.verifyCredential(token);
    expect(diskLastSeen()).toBe(new Date(persistedAt).toISOString());
    nowSpy.mockRestore();
  });

  // F8: input bounds live in the store too (route pre-validates for 400).
  it('rejects invalid / overlong device ids (F8)', () => {
    const token = 'dev_bounds_token_abcdefghijklmno';
    expect(() => store.issueCredential({ id: 'a'.repeat(129), token, platform: 'android' }))
      .toThrow(/deviceId/i);
    expect(() => store.issueCredential({ id: 'bad id', token, platform: 'android' }))
      .toThrow(/deviceId/i);
    expect(() => store.issueCredential({ id: '', token, platform: 'android' }))
      .toThrow(/deviceId/i);
    expect(() => store.issueCredential({ id: 'ok-1', token, platform: 'x'.repeat(41) }))
      .toThrow(/platform/i);
    expect(() => store.issueCredential({ id: 'ok-1', token, platform: 'android', deviceName: 'n'.repeat(101) }))
      .toThrow(/deviceName/i);
  });

  it('keeps the existing platform when the rotation omits it (F8)', () => {
    const first = 'dev_platform_first_abcdefghijkl';
    store.issueCredential({ id: 'phone-1', token: first, platform: 'android', deviceName: 'Pixel' });

    store.issueCredential({ id: 'phone-1', token: 'dev_platform_second_abcdefghijk', platform: undefined });

    expect(store.get('phone-1')!.platform).toBe('android');
    expect(store.get('phone-1')!.deviceName).toBe('Pixel');
  });
});

describe('PushGateway device credentials (E5a-3)', () => {
  let file: string;
  let store: DeviceStore;
  let gateway: PushGateway;

  beforeEach(() => {
    file = tmpStoreFile();
    store = new DeviceStore(file);
    gateway = new PushGateway(store);
  });

  it('issueDeviceToken → verifyDeviceToken returns the deviceId', () => {
    const token = 'dev_pg_token_abcdefghijklmnopq';
    gateway.issueDeviceToken('phone-1', token, { platform: 'android', deviceName: 'Pixel' });

    expect(gateway.verifyDeviceToken(token)).toEqual({ deviceId: 'phone-1' });
    expect(gateway.verifyDeviceToken('dev_other_abcdefghijklmnopq')).toBeNull();
  });

  it('listPublicDevices hides the credential hashes', () => {
    gateway.issueDeviceToken('phone-1', 'dev_pg_public_abcdefghijklm', { platform: 'android' });
    gateway.registerDevice({ id: 'phone-2', fcmToken: 'fcm', platform: 'android', apiTokenHash: 'push-hash' });

    const devices = gateway.listPublicDevices();
    expect(devices).toHaveLength(2);
    for (const device of devices) {
      expect(device).not.toHaveProperty('deviceTokenHash');
      expect(device).not.toHaveProperty('apiTokenHash');
    }
  });

  it('removeDevice revokes the credential, terminates the live socket and clears online state (F1)', () => {
    const token = 'dev_pg_remove_abcdefghijklmnop';
    gateway.issueDeviceToken('phone-1', token, { platform: 'android' });
    const ws = { readyState: 1, send: jest.fn(), terminate: jest.fn(), close: jest.fn() };
    gateway.addOnlineWs('phone-1', ws as never);
    expect(gateway.isOnline('phone-1')).toBe(true);

    expect(gateway.removeDevice('phone-1')).toBe(true);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(gateway.isOnline('phone-1')).toBe(false);
    expect(gateway.verifyDeviceToken(token)).toBeNull();
  });

  it('removeOnlineWs terminates only the tracked socket, best-effort (F1)', () => {
    const hero = { readyState: 1, send: jest.fn(), terminate: jest.fn(), close: jest.fn() };
    const survivor = { readyState: 1, send: jest.fn(), terminate: jest.fn(), close: jest.fn() };
    gateway.addOnlineWs('phone-1', hero as never);
    gateway.addOnlineWs('phone-2', survivor as never);

    gateway.removeOnlineWs('phone-1');

    expect(hero.terminate).toHaveBeenCalledTimes(1);
    expect(survivor.terminate).not.toHaveBeenCalled();
    expect(gateway.isOnline('phone-1')).toBe(false);
    expect(gateway.isOnline('phone-2')).toBe(true);
  });

  it('revokeDeviceToken clears the credential without deleting the push registration', () => {
    const token = 'dev_pg_revoke_abcdefghijklmnop';
    gateway.issueDeviceToken('phone-1', token, { platform: 'android', fcmToken: 'fcm-1' });

    expect(gateway.revokeDeviceToken('phone-1')).toBe(true);
    expect(gateway.verifyDeviceToken(token)).toBeNull();
    expect(gateway.getDevice('phone-1')!.fcmToken).toBe('fcm-1');
    expect(gateway.revokeDeviceToken('missing')).toBe(false);
  });
});
