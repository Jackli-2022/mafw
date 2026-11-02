import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fingerprintPackage } from '../../../src/plugins/package-fingerprint';

describe('fingerprintPackage', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-fingerprint-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePackage(name = 'acme', main = 'index.js'): string {
    const root = path.join(dir, name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', main }));
    fs.mkdirSync(path.dirname(path.join(root, main)), { recursive: true });
    fs.writeFileSync(path.join(root, main), `module.exports = { name: '${name}' };\n`);
    return root;
  }

  it('is stable for identical content and returns an opaque hex token', () => {
    const root = writePackage();
    const first = fingerprintPackage(path.join(root, 'index.js'), { rootDir: root });
    const second = fingerprintPackage(path.join(root, 'index.js'), { rootDir: root });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a nested source file changes', () => {
    const root = writePackage();
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'lib', 'util.js'), 'module.exports = 1;\n');
    const file = path.join(root, 'index.js');
    const before = fingerprintPackage(file, { rootDir: root });
    fs.writeFileSync(path.join(root, 'lib', 'util.js'), 'module.exports = 2;\n');
    expect(fingerprintPackage(file, { rootDir: root })).not.toBe(before);
  });

  it('includes the manifest so metadata edits are detected', () => {
    const root = writePackage();
    const file = path.join(root, 'index.js');
    const before = fingerprintPackage(file, { rootDir: root });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'acme', version: '2.0.0', main: 'index.js' }));
    expect(fingerprintPackage(file, { rootDir: root })).not.toBe(before);
  });

  it('ignores node_modules, .git, .plugin-manager and log/temp files', () => {
    const root = writePackage();
    const file = path.join(root, 'index.js');
    const before = fingerprintPackage(file, { rootDir: root });

    for (const ignored of ['node_modules', '.git', '.plugin-manager', 'logs']) {
      const target = path.join(root, ignored);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'noise.js'), '// noise\n');
    }
    fs.writeFileSync(path.join(root, 'debug.log'), 'noise\n');
    fs.writeFileSync(path.join(root, 'debug.log.1'), 'noise\n');
    fs.writeFileSync(path.join(root, 'scratch.tmp'), 'noise\n');
    fs.writeFileSync(path.join(root, 'scratch.temp'), 'noise\n');
    fs.writeFileSync(path.join(root, 'index.js.swp'), 'noise\n');
    fs.writeFileSync(path.join(root, 'backup~'), 'noise\n');
    fs.writeFileSync(path.join(root, '.DS_Store'), 'noise\n');

    expect(fingerprintPackage(file, { rootDir: root })).toBe(before);
  });

  it('hashes only the entry file for a single-file package', () => {
    const pkg = path.join(dir, 'solo.js');
    fs.writeFileSync(pkg, `module.exports = { name: 'solo' };\n`);
    fs.writeFileSync(path.join(dir, 'neighbour.js'), 'module.exports = {};\n');
    const before = fingerprintPackage(pkg);
    fs.writeFileSync(path.join(dir, 'neighbour.js'), 'module.exports = { changed: true };\n');
    expect(fingerprintPackage(pkg)).toBe(before);

    fs.writeFileSync(pkg, `module.exports = { name: 'solo', extra: 1 };\n`);
    expect(fingerprintPackage(pkg)).not.toBe(before);
  });

  it('discovers the package root from the manifest for nested entry files', () => {
    const root = writePackage('nested', 'lib/entry.js');
    const file = path.join(root, 'lib', 'entry.js');
    fs.writeFileSync(path.join(root, 'lib', 'helper.js'), 'module.exports = 1;\n');
    const before = fingerprintPackage(file);
    fs.writeFileSync(path.join(root, 'lib', 'helper.js'), 'module.exports = 2;\n');
    expect(fingerprintPackage(file)).not.toBe(before);
  });

  it('does not walk into an unrelated directory that happens to hold plugin.json', () => {
    // A manifest whose `main` does not resolve to the entry file must not turn a
    // single-file package into a whole-directory hash.
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'other', main: 'elsewhere.js' }));
    const pkg = path.join(dir, 'solo.js');
    fs.writeFileSync(pkg, 'module.exports = {};\n');
    const before = fingerprintPackage(pkg);
    fs.writeFileSync(path.join(dir, 'unrelated.js'), 'module.exports = {};\n');
    expect(fingerprintPackage(pkg)).toBe(before);
  });

  it('throws a readable error when the entry file is missing', () => {
    expect(() => fingerprintPackage(path.join(dir, 'missing.js'))).toThrow(/main file not found/i);
  });
});
