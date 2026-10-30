import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodA2AArtifactStore } from '../../../src/core/pod/pod-a2a-artifacts';

function makeRoots(): { projectDir: string; artifactRoot: string; cleanup(): void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-artifact-store-'));
  const projectDir = path.join(base, 'project');
  const artifactRoot = path.join(base, 'staging');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'receipts', 'goal-1'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'receipts', 'goal-1', 'loop-1-receipt.json'), JSON.stringify({ ok: true }));
  fs.writeFileSync(path.join(projectDir, 'notes.md'), '# notes');
  fs.writeFileSync(path.join(projectDir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  fs.writeFileSync(path.join(projectDir, 'big.txt'), 'x'.repeat(40 * 1024));
  fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET=1');
  fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.git', 'config'), '[core]');
  fs.writeFileSync(path.join(artifactRoot, 'staged.md'), '# staged');
  fs.writeFileSync(path.join(artifactRoot, 'notes.md'), '# staging copy');
  return {
    projectDir,
    artifactRoot,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

describe('PodA2AArtifactStore', () => {
  test('resolves project-relative refs with a content type', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots);
    const found = store.get('receipts/goal-1/loop-1-receipt.json');
    expect(found?.contentType).toContain('application/json');
    expect(found?.path).toBe(fs.realpathSync(path.join(roots.projectDir, 'receipts', 'goal-1', 'loop-1-receipt.json')));
    roots.cleanup();
  });

  test('prefers the project over the staging dir', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots);
    expect(fs.readFileSync(store.get('notes.md')!.path, 'utf-8')).toBe('# notes');
    expect(fs.readFileSync(store.get('staged.md')!.path, 'utf-8')).toBe('# staged');
    roots.cleanup();
  });

  test('describe inlines small text and reports bytes', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots);
    const summary = store.describe('notes.md');
    expect(summary).toMatchObject({ ref: 'notes.md', bytes: 7, mediaType: 'text/markdown; charset=utf-8', content: '# notes' });
    roots.cleanup();
  });

  test('describe omits inline content for binary and oversized files', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots);
    const binary = store.describe('shot.png');
    expect(binary?.content).toBeUndefined();
    expect(binary?.mediaType).toBe('image/png');
    expect(binary?.bytes).toBe(6);
    const big = store.describe('big.txt');
    expect(big?.content).toBeUndefined();
    expect(big?.bytes).toBe(40 * 1024);
    roots.cleanup();
  });

  test('rejects traversal, absolute paths, and dotfiles', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots);
    for (const ref of ['../secret', '..%2Fsecret', 'receipts/../../secret', '/etc/passwd', 'C:\\Windows\\win.ini', '.env', '.git/config', 'a\0b', '']) {
      expect(store.get(ref)).toBeNull();
      expect(store.describe(ref)).toBeNull();
    }
    roots.cleanup();
  });

  test('returns null for missing files', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots);
    expect(store.get('nope.md')).toBeNull();
    expect(store.describe('nope.md')).toBeNull();
    roots.cleanup();
  });

  test('accepts a plain staging root for backwards compatibility', () => {
    const roots = makeRoots();
    const store = new PodA2AArtifactStore(roots.artifactRoot);
    expect(fs.readFileSync(store.get('staged.md')!.path, 'utf-8')).toBe('# staged');
    expect(store.get('notes.md')?.path).toBe(fs.realpathSync(path.join(roots.artifactRoot, 'notes.md')));
    roots.cleanup();
  });
});
