import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computePackageIntegrity,
  verifyDeclaredIntegrity,
} from '../../../src/plugins/package-integrity';

function makePackage(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-integrity-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('package integrity', () => {
  it('hashes every package file with a stable fingerprint', () => {
    const dir = makePackage({
      'plugin.json': '{"name":"acme"}',
      'index.js': 'module.exports={}',
    });
    const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(snapshot.files).sort()).toEqual(['index.js', 'plugin.json']);
    expect(computePackageIntegrity(dir, path.join(dir, 'index.js'))).toEqual(snapshot);
  });

  it('verifies a declared manifest integrity map', () => {
    const dir = makePackage({ 'index.js': 'module.exports={}' });
    const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
    expect(verifyDeclaredIntegrity(dir, { algorithm: 'sha256', files: snapshot.files }).ok).toBe(true);
    expect(verifyDeclaredIntegrity(dir, {
      algorithm: 'sha256', files: { ...snapshot.files, 'index.js': 'sha256-deadbeef' },
    })).toMatchObject({ ok: false });
  });

  it('ignores node_modules, logs and temp files in a directory package', () => {
    const dir = makePackage({
      'plugin.json': '{"name":"acme"}',
      'index.js': 'module.exports={}',
      'node_modules/x/index.js': 'x',
      'debug.log': 'x',
      'scratch.tmp': 'x',
    });
    const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
    expect(Object.keys(snapshot.files).sort()).toEqual(['index.js', 'plugin.json']);
  });

  it('accepts a declared map for a real package with plugin.json', () => {
    const dir = makePackage({ 'plugin.json': '{"name":"acme"}', 'index.js': 'x' });
    const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
    const declared = { 'index.js': snapshot.files['index.js'] };
    expect(verifyDeclaredIntegrity(dir, { algorithm: 'sha256', files: declared }).ok).toBe(true);
  });

  it('reports missing and unexpected files', () => {
    const dir = makePackage({ 'plugin.json': '{"name":"acme"}', 'index.js': 'x' });
    const result = verifyDeclaredIntegrity(dir, {
      algorithm: 'sha256',
      files: { 'index.js': 'sha256-deadbeef', 'missing.js': 'sha256-x' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('mismatch: index.js');
    expect(result.errors.join(' ')).toContain('missing: missing.js');
  });
});
