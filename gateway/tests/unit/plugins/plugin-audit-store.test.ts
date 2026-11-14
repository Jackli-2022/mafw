import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { PluginAuditStore } from '../../../src/plugins/plugin-audit-store';

describe('PluginAuditStore', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: PluginAuditStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-audit-'));
    db = new GatewayDatabase(path.join(dir, 'gateway.db'));
    store = new PluginAuditStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends and lists audit events newest first', () => {
    expect(store.append({
      action: 'install', package: 'acme', version: '1.0.0',
      principalKind: 'human', principalMethod: 'human-token', result: 'ok',
      detail: { permissions: ['actions'] },
    })).toBe(true);
    store.append({ action: 'disable', package: 'acme', result: 'ok' });

    const events = store.list({ package: 'acme', limit: 10 });
    expect(events.map((event) => event.action)).toEqual(['disable', 'install']);
    expect(events[1].detail).toEqual({ permissions: ['actions'] });
  });

  it('drops detail keys outside the allowlist', () => {
    store.append({
      action: 'install', package: 'acme', result: 'ok',
      detail: { reason: 'ok', token: 'secret', path: 'C:/Users/x' },
    });
    expect(store.list({ limit: 1 })[0].detail).toEqual({ reason: 'ok' });
  });

  it('filters by package and caps the limit', () => {
    store.append({ action: 'install', package: 'acme', result: 'ok' });
    store.append({ action: 'install', package: 'beta', result: 'ok' });
    expect(store.list({ package: 'beta', limit: 10 })).toHaveLength(1);
    expect(store.list({ limit: 9999 })).toHaveLength(2);
  });
});
