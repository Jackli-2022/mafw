import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ProbeWorkspaceFactory,
  isPathInside,
} from '../../../src/core/pod/pod-probe-workspace';

describe('ProbeWorkspaceFactory', () => {
  let root: string;
  let projectDir: string;
  let workspaces: ProbeWorkspaceFactory;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-probe-ws-'));
    projectDir = path.join(root, 'project');
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export {};\n', 'utf-8');
    workspaces = new ProbeWorkspaceFactory({ baseDir: path.join(root, 'probes') });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('creates a workspace outside the main project and disposes it', async () => {
    const workspace = await workspaces.prepare(projectDir, 'g1', 'p1');

    expect(workspace.dir).not.toBe(projectDir);
    expect(isPathInside(workspace.dir, projectDir)).toBe(false);
    expect(isPathInside(workspace.dir, path.join(root, 'project'))).toBe(false);
    expect(fs.existsSync(workspace.dir)).toBe(true);
    expect(workspace).toMatchObject({ goalId: 'g1', probeId: 'p1' });

    await workspaces.dispose(workspace);
    expect(fs.existsSync(workspace.dir)).toBe(false);
    // The main workspace is untouched.
    expect(fs.readFileSync(path.join(projectDir, 'src', 'index.ts'), 'utf-8')).toBe('export {};\n');
    expect(fs.existsSync(projectDir)).toBe(true);
  });

  test('never reuses a directory between probes', async () => {
    const first = await workspaces.prepare(projectDir, 'g1', 'p1');
    const second = await workspaces.prepare(projectDir, 'g1', 'p1');

    expect(second.dir).not.toBe(first.dir);
    await workspaces.dispose(first);
    expect(fs.existsSync(first.dir)).toBe(false);
    expect(fs.existsSync(second.dir)).toBe(true);
    await workspaces.dispose(second);
  });

  test('dispose is idempotent', async () => {
    const workspace = await workspaces.prepare(projectDir, 'g1', 'p1');
    await workspaces.dispose(workspace);
    await expect(workspaces.dispose(workspace)).resolves.toBeUndefined();
  });

  test('refuses to prepare a workspace inside the main project', async () => {
    const inside = new ProbeWorkspaceFactory({ baseDir: path.join(projectDir, '.probes') });

    await expect(inside.prepare(projectDir, 'g1', 'p1')).rejects.toThrow(/outside the main project/);
    expect(fs.existsSync(path.join(projectDir, '.probes')) ? fs.readdirSync(path.join(projectDir, '.probes')) : [])
      .toEqual([]);
  });

  test('refuses to dispose a directory outside the factory base dir', async () => {
    const forged = path.join(root, 'forged');
    fs.mkdirSync(forged, { recursive: true });
    fs.writeFileSync(path.join(forged, 'keep.txt'), 'keep', 'utf-8');

    await expect(workspaces.dispose({ dir: forged, projectDir, goalId: 'g1', probeId: 'p1' }))
      .rejects.toThrow(/refusing to dispose/);
    expect(fs.readFileSync(path.join(forged, 'keep.txt'), 'utf-8')).toBe('keep');
  });

  test('refuses to dispose a directory inside the main project', async () => {
    const workspace = {
      dir: path.join(projectDir, 'src'),
      projectDir,
      goalId: 'g1',
      probeId: 'p1',
    };

    await expect(workspaces.dispose(workspace)).rejects.toThrow(/refusing to dispose/);
    expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true);
  });

  test('rejects unsafe goal or probe identifiers instead of building paths from them', async () => {
    await expect(workspaces.prepare(projectDir, '../g', 'p1')).rejects.toThrow(/identifier/);
    await expect(workspaces.prepare(projectDir, 'g1', '..\\p1')).rejects.toThrow(/identifier/);
    await expect(workspaces.prepare(projectDir, 'g1', '')).rejects.toThrow(/identifier/);
  });
});
