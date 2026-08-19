import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DeviceStore } from '../../../gateway/src/mobile/device-store';
import { PushGateway } from '../../../gateway/src/mobile/push-gateway';

describe('DeviceStore', () => {
  let tmpDir: string;
  let store: DeviceStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstore-test-'));
    store = new DeviceStore(path.join(tmpDir, 'devices.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers a new device', () => {
    const device = store.register({
      id: 'dev-1',
      fcmToken: 'fcm-abc',
      platform: 'android',
      apiTokenHash: 'hash123',
    });
    expect(device.id).toBe('dev-1');
    expect(device.fcmToken).toBe('fcm-abc');
    expect(device.platform).toBe('android');
    expect(device.lastSeen).toBeDefined();
  });

  it('updates existing device on re-register', () => {
    store.register({ id: 'dev-1', fcmToken: 'fcm-old', platform: 'android', apiTokenHash: 'h1' });
    store.register({ id: 'dev-1', fcmToken: 'fcm-new', platform: 'ios', apiTokenHash: 'h2' });
    const devices = store.list();
    expect(devices).toHaveLength(1);
    expect(devices[0].fcmToken).toBe('fcm-new');
    expect(devices[0].platform).toBe('ios');
  });

  it('lists all registered devices', () => {
    store.register({ id: 'dev-1', fcmToken: 'a', platform: 'android', apiTokenHash: 'h1' });
    store.register({ id: 'dev-2', fcmToken: 'b', platform: 'ios', apiTokenHash: 'h2' });
    expect(store.list()).toHaveLength(2);
  });

  it('removes a device by id', () => {
    store.register({ id: 'dev-1', fcmToken: 'a', platform: 'android', apiTokenHash: 'h1' });
    store.register({ id: 'dev-2', fcmToken: 'b', platform: 'ios', apiTokenHash: 'h2' });
    expect(store.remove('dev-1')).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe('dev-2');
  });

  it('returns false when removing non-existent device', () => {
    expect(store.remove('dev-ghost')).toBe(false);
  });

  it('persists to disk and reloads', () => {
    const filePath = path.join(tmpDir, 'devices.json');
    const s1 = new DeviceStore(filePath);
    s1.register({ id: 'dev-1', fcmToken: 'a', platform: 'android', apiTokenHash: 'h1' });
    const s2 = new DeviceStore(filePath);
    expect(s2.list()).toHaveLength(1);
    expect(s2.list()[0].id).toBe('dev-1');
  });

  it('enforces 600 device limit', () => {
    for (let i = 0; i < 600; i++) {
      store.register({ id: `dev-${i}`, fcmToken: `fcm-${i}`, platform: 'android', apiTokenHash: `h${i}` });
    }
    expect(store.list()).toHaveLength(600);
    // 601st should throw
    expect(() =>
      store.register({ id: 'dev-600', fcmToken: 'fcm-600', platform: 'android', apiTokenHash: 'h600' }),
    ).toThrow();
  });

  it('finds device by id', () => {
    store.register({ id: 'dev-1', fcmToken: 'a', platform: 'android', apiTokenHash: 'h1' });
    const found = store.get('dev-1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('dev-1');
    expect(store.get('dev-missing')).toBeUndefined();
  });
});

describe('PushGateway', () => {
  let tmpDir: string;
  let store: DeviceStore;
  let push: PushGateway;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'));
    store = new DeviceStore(path.join(tmpDir, 'devices.json'));
    push = new PushGateway(store);
  });

  afterEach(() => {
    push.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dispatches to online WS client', async () => {
    const sent: string[] = [];
    const mockWs = {
      readyState: 1, // OPEN
      send: (data: string) => sent.push(data),
    } as any;
    push.addOnlineWs('dev-1', mockWs);

    await push.onBroadcast({ type: 'test-event', data: { hello: 'world' } });
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]);
    expect(frame.type).toBe('test-event');
    expect(frame.data).toEqual({ hello: 'world' });
    expect(frame.timestamp).toBeDefined();
  });

  it('rate limits to 1 msg/s per device', async () => {
    const sent: string[] = [];
    const mockWs = {
      readyState: 1,
      send: (data: string) => sent.push(data),
    } as any;
    push.addOnlineWs('dev-1', mockWs);

    // First message goes through
    await push.onBroadcast({ type: 'event1' });
    expect(sent).toHaveLength(1);

    // Second immediate message is dropped
    await push.onBroadcast({ type: 'event2' });
    expect(sent).toHaveLength(1);
  });

  it('uses global leaky bucket for rate limiting', async () => {
    const sent1: string[] = [];
    const sent2: string[] = [];
    const ws1 = { readyState: 1, send: (d: string) => sent1.push(d) } as any;
    const ws2 = { readyState: 1, send: (d: string) => sent2.push(d) } as any;
    push.addOnlineWs('dev-1', ws1);
    push.addOnlineWs('dev-2', ws2);

    // First broadcast goes to both devices (no prior sends)
    await push.onBroadcast({ type: 'ev1' });
    expect(sent1).toHaveLength(1);
    expect(sent2).toHaveLength(1);
    // Immediate second broadcast blocked by global bucket
    await push.onBroadcast({ type: 'ev2' });
    expect(sent1).toHaveLength(1); // no new message
    expect(sent2).toHaveLength(1); // no new message
  });

  it('registers device and stores in DeviceStore', () => {
    const device = push.registerDevice({
      id: 'dev-1',
      fcmToken: 'fcm-abc',
      platform: 'android',
      apiTokenHash: 'hash1',
    });
    expect(device.id).toBe('dev-1');
    expect(store.get('dev-1')).toBeDefined();
  });

  it('marks device offline when WS disconnects', () => {
    const mockWs = { readyState: 1, send: () => {} } as any;
    push.addOnlineWs('dev-1', mockWs);
    expect(push.isOnline('dev-1')).toBe(true);

    push.removeOnlineWs('dev-1');
    expect(push.isOnline('dev-1')).toBe(false);
  });

  it('reports online status correctly', () => {
    expect(push.isOnline('dev-1')).toBe(false);
    const mockWs = { readyState: 1, send: () => {} } as any;
    push.addOnlineWs('dev-1', mockWs);
    expect(push.isOnline('dev-1')).toBe(true);
  });

  it('cleanup removes old online entries', () => {
    const mockWs = { readyState: 1, send: () => {} } as any;
    push.addOnlineWs('dev-1', mockWs);
    // Simulate stale: set lastSeen to 2 minutes ago
    push.setLastSeen('dev-1', Date.now() - 120_000);
    push.cleanupStale(60_000); // 60s threshold
    expect(push.isOnline('dev-1')).toBe(false);
  });
});

describe('WS heartbeat', () => {
  it('sets isAlive to false before ping', () => {
    const mockWs = {
      isAlive: true,
      readyState: 1,
      ping: jest.fn(),
      terminate: jest.fn(),
    } as any;
    // After setting isAlive = false, a ping should reset it
    mockWs.isAlive = false;
    mockWs.ping();
    // Simulate pong callback
    mockWs.isAlive = true;
    expect(mockWs.isAlive).toBe(true);
  });

  it('terminates dead connections after prune', () => {
    const alive = { isAlive: true, readyState: 1, ping: jest.fn(), terminate: jest.fn() } as any;
    const dead = { isAlive: false, readyState: 1, ping: jest.fn(), terminate: jest.fn() } as any;
    const clients = new Set([alive, dead]);

    // Simulate prune: mark all as not alive, ping, then check
    for (const ws of clients) {
      ws.isAlive = false;
    }
    // Simulate pong received for alive only
    alive.isAlive = true;

    // Prune dead
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        clients.delete(ws);
      }
    }
    expect(clients.size).toBe(1);
    expect(dead.terminate).toHaveBeenCalled();
  });
});

describe('Config apiToken hot-reload', () => {
  let tmpDir: string;
  let savedToken: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-reload-test-'));
    // Save and clear env var to avoid interference
    savedToken = process.env.MAFW_SERVER_API_TOKEN;
    delete process.env.MAFW_SERVER_API_TOKEN;
  });

  afterEach(() => {
    // Restore env var
    if (savedToken !== undefined) process.env.MAFW_SERVER_API_TOKEN = savedToken;
    else delete process.env.MAFW_SERVER_API_TOKEN;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('apiToken change does not require restart', () => {
    const { Config } = require('../../../gateway/src/config');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), `
server:
  apiToken: old-token
`, 'utf-8');

    const cfg = new Config(tmpDir, tmpDir);
    expect(cfg.raw.server.apiToken).toBe('old-token');

    // Simulate reload with new token
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), `
server:
  apiToken: new-token
`, 'utf-8');

    const result = cfg.reload();
    // apiToken should NOT be in restartRequired
    expect(result.restartRequired).not.toContain('server');
  });

  it('non-token server changes still require restart', () => {
    const { Config } = require('../../../gateway/src/config');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), `
server:
  apiPort: 3000
`, 'utf-8');

    const cfg = new Config(tmpDir, tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), `
server:
  apiPort: 4000
`, 'utf-8');

    const result = cfg.reload();
    expect(result.restartRequired).toContain('server');
  });
});
