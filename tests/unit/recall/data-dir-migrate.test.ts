import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateDataDir } from '../../../gateway/src/recall/data-dir-migrate';

describe('migrateDataDir (memory data → gateway package .mafw)', () => {
  let targetDir: string;
  let legacyDir: string;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ddm-'));
    targetDir = path.join(root, 'gateway', '.mafw');
    legacyDir = path.join(root, 'project', '.mafw');
    fs.mkdirSync(path.join(legacyDir, 'memory', 'concepts'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'automations'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'events'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'registry'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'memory', 'concepts', 'x.md'), 'x', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'memory', 't1.db'), 'db', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'recall-reflect-cursor.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'automations', 'turn-compress.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'events', 'evt.jsonl'), 'regenerable', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'registry', 'plugin.json'), 'regenerable', 'utf-8');
  });

  test('moves durable data and removes the legacy directory', () => {
    const res = migrateDataDir(targetDir, legacyDir);

    expect(res.migrated).toBe(true);
    expect(res.moved).toContain('memory');
    expect(res.moved).toContain('recall-reflect-cursor.json');
    expect(res.moved).toContain('automations');
    // regenerable pieces stay behind and are removed with the legacy dir
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(res.legacyRemoved).toBe(true);
    // data landed at the target
    expect(fs.existsSync(path.join(targetDir, 'memory', 't1.db'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'memory', 'concepts', 'x.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'recall-reflect-cursor.json'))).toBe(true);
    // marker written
    expect(fs.existsSync(path.join(targetDir, '.data-migrated'))).toBe(true);
  });

  test('idempotent: second run is a no-op', () => {
    migrateDataDir(targetDir, legacyDir);
    const res2 = migrateDataDir(targetDir, legacyDir);
    expect(res2.migrated).toBe(false);
    expect(res2.moved).toEqual([]);
  });

  test('overwrites a pre-existing empty target store (field-init empty db)', () => {
    // simulate class-field initialization creating an empty store at the target
    fs.mkdirSync(path.join(targetDir, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'memory', 't1.db'), '', 'utf-8');

    const res = migrateDataDir(targetDir, legacyDir);
    expect(res.migrated).toBe(true);
    // legacy data wins over the empty placeholder
    expect(fs.readFileSync(path.join(targetDir, 'memory', 't1.db'), 'utf-8')).toBe('db');
  });

  test('no-op when the target already migrated (marker present)', () => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, '.data-migrated'), new Date().toISOString(), 'utf-8');
    const res = migrateDataDir(targetDir, legacyDir);
    expect(res.migrated).toBe(false);
    expect(fs.existsSync(legacyDir)).toBe(true); // untouched
  });

  test('no-op when there is no legacy data', () => {
    const res = migrateDataDir(targetDir, path.join(targetDir, 'nope'));
    expect(res.migrated).toBe(false);
  });

  test('failure keeps legacy data (no marker)', () => {
    // make the target read-only-ish by pointing memory at a FILE
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.writeFileSync(targetDir, 'i am a file', 'utf-8');
    const res = migrateDataDir(targetDir, legacyDir);
    expect(res.migrated).toBe(false);
    expect(fs.existsSync(path.join(legacyDir, 'memory', 't1.db'))).toBe(true);
  });
});
