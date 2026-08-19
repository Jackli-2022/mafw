import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateConstraintsFiles } from '../../../gateway/src/recall/constraints-migrate';

jest.mock('../../../gateway/src/memory/harmonic-file-store.js', () => {
  const writes: any[] = [];
  return {
    __writes: writes,
    HarmonicUnitFileStore: jest.fn().mockImplementation(() => ({
      write: async (unit: any) => {
        writes.push(unit);
        return unit.id;
      },
    })),
  };
});

const { __writes } = jest.requireMock('../../../gateway/src/memory/harmonic-file-store.js') as any;

describe('migrateConstraintsFiles', () => {
  let tmpDir: string;
  let mafwDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-cm-'));
    mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    __writes.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('migrates entries into harmonic memory and renames the file', async () => {
    fs.writeFileSync(
      path.join(mafwDir, 'constraints.json'),
      JSON.stringify(['user prefers self-hosted', 'user is allergic to nuts']),
      'utf-8',
    );

    const res = await migrateConstraintsFiles([tmpDir]);

    expect(res).toEqual({ migrated: 2, renamed: 1, skipped: 0 });
    expect(fs.existsSync(path.join(mafwDir, 'constraints.json'))).toBe(false);
    expect(fs.existsSync(path.join(mafwDir, 'constraints.migrated.json'))).toBe(true);
    expect(__writes.length).toBe(2);
    expect(__writes[0]).toMatchObject({ type: 'semantic', memory_value: 'user prefers self-hosted', energy: 0.9 });
    expect(__writes[0]).not.toHaveProperty('goal_id');
  });

  test('idempotent: second run skips already-migrated projects', async () => {
    fs.writeFileSync(path.join(mafwDir, 'constraints.json'), JSON.stringify(['one']), 'utf-8');
    await migrateConstraintsFiles([tmpDir]);
    __writes.length = 0;

    const res = await migrateConstraintsFiles([tmpDir]);
    expect(res).toEqual({ migrated: 0, renamed: 0, skipped: 1 });
    expect(__writes.length).toBe(0);
  });

  test('handles { constraints: [...] } object form', async () => {
    fs.writeFileSync(path.join(mafwDir, 'constraints.json'), JSON.stringify({ constraints: ['a', 'b', ''] }), 'utf-8');
    const res = await migrateConstraintsFiles([tmpDir]);
    expect(res.migrated).toBe(2); // blank entry dropped
  });

  test('renames empty constraint files without writing', async () => {
    fs.writeFileSync(path.join(mafwDir, 'constraints.json'), JSON.stringify([]), 'utf-8');
    const res = await migrateConstraintsFiles([tmpDir]);
    expect(res).toEqual({ migrated: 0, renamed: 1, skipped: 0 });
    expect(__writes.length).toBe(0);
  });

  test('keeps the file when unparseable (fail-safe)', async () => {
    fs.writeFileSync(path.join(mafwDir, 'constraints.json'), '{broken', 'utf-8');
    const res = await migrateConstraintsFiles([tmpDir]);
    expect(res.skipped).toBe(1);
    expect(fs.existsSync(path.join(mafwDir, 'constraints.json'))).toBe(true);
  });

  test('no-op when no constraints file exists', async () => {
    const res = await migrateConstraintsFiles([tmpDir]);
    expect(res).toEqual({ migrated: 0, renamed: 0, skipped: 0 });
  });
});
