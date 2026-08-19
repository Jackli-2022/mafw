import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateGatewayDb } from '../../../gateway/src/recall/gateway-db-migrate';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';

describe('migrateGatewayDb (file → DB)', () => {
  let tmpDir: string;
  let memoryDir: string;
  let cursorFile: string;
  let managerFiles: Array<{ projectDir: string; filePath: string }>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-gdm-'));
    memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    cursorFile = path.join(tmpDir, 'recall-reflect-cursor.json');
    managerFiles = [
      { projectDir: 'C:\\proj-a', filePath: path.join(tmpDir, 'a', '.mafw', 'manager-session.json') },
      { projectDir: 'C:\\proj-b', filePath: path.join(tmpDir, 'b', '.mafw', 'manager-session.json') },
    ];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('renames legacy t1.db → gateway.db with WAL companions', () => {
    // create a REAL sqlite t1.db (with a companion wal) so the migrated
    // database opens cleanly afterwards
    const legacy = new GatewayDatabase(path.join(memoryDir, 't1.db'));
    legacy.append({ session_id: 's1', turn_id: 1, source: 'user_input', content: 'hello', failure: 0 });
    legacy.close();

    const res = migrateGatewayDb(memoryDir, [], null, null);
    expect(res.renamed).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, 'gateway.db'))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, 't1.db'))).toBe(false);

    const db = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    expect(db.count()).toBe(1); // data survived the rename
    db.close();
  });

  test('idempotent: skips rename when gateway.db already exists', () => {
    const existing = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    existing.kvSet('s', 'k', 'v');
    existing.close();
    // legacy t1.db also present — must NOT be renamed
    const legacy = new GatewayDatabase(path.join(memoryDir, 't1.db'));
    legacy.close();

    const res = migrateGatewayDb(memoryDir, [], null, null);
    expect(res.renamed).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, 't1.db'))).toBe(true);
    const db = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    expect(db.kvGet('s', 'k')).toBe('v');
    db.close();
  });

  test('imports manager-session files and deletes them', () => {
    for (const ms of managerFiles) {
      fs.mkdirSync(path.dirname(ms.filePath), { recursive: true });
      fs.writeFileSync(ms.filePath, JSON.stringify({ sessionId: `ses-${ms.projectDir}`, createdAt: '2026-01-01' }), 'utf-8');
    }

    const res = migrateGatewayDb(memoryDir, managerFiles, null, null);
    expect(res.managerSessions).toBe(2);
    for (const ms of managerFiles) expect(fs.existsSync(ms.filePath)).toBe(false);

    const db = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    expect(db.kvGet('manager-session', 'C:\\proj-a')).toEqual({ sessionId: 'ses-C:\\proj-a', createdAt: '2026-01-01' });
    db.close();
  });

  test('skips manager-session files with relative projectDir (historical artifacts)', () => {
    const relFile = path.join(tmpDir, 'rel.json');
    fs.writeFileSync(relFile, JSON.stringify({ sessionId: 'ses-rel', createdAt: '2026-01-01' }), 'utf-8');

    const res = migrateGatewayDb(memoryDir, [{ projectDir: '.', filePath: relFile }], null, null);
    expect(res.managerSessions).toBe(0);
    // file kept (not imported, not deleted)
    expect(fs.existsSync(relFile)).toBe(true);

    const db = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    expect(db.kvGet('manager-session', '.')).toBeNull();
    db.close();
  });

  test('imports the reflect cursor and deletes the file', () => {
    fs.writeFileSync(cursorFile, JSON.stringify({ s1: ['ep-1', 'ep-2'], s2: ['ep-3'] }), 'utf-8');

    const res = migrateGatewayDb(memoryDir, [], cursorFile, null);
    expect(res.cursorImported).toBe(true);
    expect(fs.existsSync(cursorFile)).toBe(false);

    const db = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    expect(db.kvGet('reflect-cursor', 's1')).toEqual(['ep-1', 'ep-2']);
    expect(db.kvGet('reflect-cursor', 's2')).toEqual(['ep-3']);
    db.close();
  });

  test('writes the registry snapshot', () => {
    const snapshot = { 'C:\\proj-a': { mafwDir: 'x' } };
    const res = migrateGatewayDb(memoryDir, [], null, snapshot);
    expect(res.registrySnapshot).toBe(true);

    const db = new GatewayDatabase(path.join(memoryDir, 'gateway.db'));
    expect(db.kvGet('registry', 'snapshot')).toEqual(snapshot);
    db.close();
  });

  test('keeps sources intact on failure', () => {
    const badFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badFile, '{broken', 'utf-8');

    const res = migrateGatewayDb(memoryDir, [{ projectDir: 'p', filePath: badFile }], null, null);
    expect(res.managerSessions).toBe(0);
    expect(fs.existsSync(badFile)).toBe(true);
  });
});
