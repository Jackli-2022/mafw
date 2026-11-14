import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageLastGoodStore } from '../../../src/plugins/package-last-good';

function writePackage(dir: string, name: string, content: string): void {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'index.js'), content);
}

describe('PackageLastGoodStore', () => {
  it('snapshots and restores the previous package directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-last-good-'));
    writePackage(dir, 'acme', 'old');
    const store = new PackageLastGoodStore(dir);
    expect(store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' })).toBe(true);
    fs.writeFileSync(path.join(dir, 'acme', 'index.js'), 'new');
    expect(store.restore('acme')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'acme', 'index.js'), 'utf8')).toBe('old');
    expect(store.read('acme')).toMatchObject({ version: '1.0.0', fingerprint: 'sha256:old' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips snapshots larger than the cap', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-last-good-'));
    writePackage(dir, 'acme', 'x'.repeat(1024));
    const store = new PackageLastGoodStore(dir, { maxBytes: 10 });
    expect(store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' })).toBe(false);
    expect(store.read('acme')).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes snapshot and metadata with the package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-last-good-'));
    writePackage(dir, 'acme', 'old');
    const store = new PackageLastGoodStore(dir);
    store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' });
    store.remove('acme');
    expect(store.read('acme')).toBeNull();
    expect(fs.existsSync(path.join(dir, '.last-good', 'acme'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
