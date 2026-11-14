import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageStateStore, PACKAGE_STATE_FILE } from '../../../src/plugins/package-state-store';

function emptyState() {
  return {
    version: 2,
    disabled: [],
    safeMode: false,
    quarantined: [],
    installed: {},
  };
}

describe('PackageStateStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pkg-state-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns v2 defaults when the state file is missing', () => {
    const store = new PackageStateStore(dir);
    expect(store.read()).toEqual(emptyState());
    expect(store.wasCorrupt()).toBe(false);
    expect(store.isDisabled('acme')).toBe(false);
  });

  it('persists a disabled package across store instances', () => {
    const store = new PackageStateStore(dir);
    store.setDisabled('acme', true);

    expect(fs.existsSync(path.join(dir, PACKAGE_STATE_FILE))).toBe(true);
    expect(store.isDisabled('acme')).toBe(true);

    const reloaded = new PackageStateStore(dir);
    expect(reloaded.read()).toEqual({ ...emptyState(), disabled: ['acme'] });
    expect(reloaded.isDisabled('acme')).toBe(true);
    expect(reloaded.isDisabled('other')).toBe(false);
  });

  it('removes the entry when a package is enabled again', () => {
    const store = new PackageStateStore(dir);
    store.setDisabled('acme', true);
    store.setDisabled('beta', true);
    store.setDisabled('acme', false);

    expect(new PackageStateStore(dir).read()).toEqual({ ...emptyState(), disabled: ['beta'] });
    // Enabling a package that was never disabled is a no-op.
    store.setDisabled('beta', false);
    store.setDisabled('beta', false);
    expect(new PackageStateStore(dir).read()).toEqual(emptyState());
  });

  it('creates missing parent directories when persisting', () => {
    const nested = path.join(dir, 'nested', 'deeper');
    const store = new PackageStateStore(nested);
    store.setDisabled('acme', true);

    expect(fs.existsSync(path.join(nested, PACKAGE_STATE_FILE))).toBe(true);
    expect(new PackageStateStore(nested).isDisabled('acme')).toBe(true);
  });

  it('upgrades a v1 document without losing disabled', () => {
    fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE),
      JSON.stringify({ version: 1, disabled: ['acme'] }));
    const store = new PackageStateStore(dir);
    expect(store.read()).toMatchObject({
      version: 2, disabled: ['acme'], safeMode: false, quarantined: [],
    });
    expect(store.wasCorrupt()).toBe(false);
  });

  it('enters safe mode when an existing state file is corrupt', () => {
    fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE), '{ not json');
    const store = new PackageStateStore(dir);
    expect(store.read()).toMatchObject({ version: 2, safeMode: true });
    expect(store.wasCorrupt()).toBe(true);
    expect(store.isDisabled('acme')).toBe(false);

    store.setDisabled('acme', true);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, PACKAGE_STATE_FILE), 'utf-8'));
    expect(parsed).toMatchObject({ version: 2, disabled: ['acme'], safeMode: true });
  });

  it('drops non-string entries from a hand-edited state file', () => {
    fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE), JSON.stringify({
      version: 2,
      disabled: ['acme', 42, '', null, '../escape'],
    }));
    const store = new PackageStateStore(dir);
    expect(store.read().disabled).toEqual(['acme']);
  });

  it('persists safe mode and quarantine entries', () => {
    const store = new PackageStateStore(dir);
    store.setSafeMode(true);
    store.setQuarantine({
      name: 'acme', reason: 'integrity mismatch', at: '2026-11-14T00:00:00.000Z',
      version: '1.0.0', fingerprint: 'sha256:abc',
    });

    const reloaded = new PackageStateStore(dir);
    expect(reloaded.isSafeMode()).toBe(true);
    expect(reloaded.getQuarantine('acme')).toMatchObject({ reason: 'integrity mismatch' });
    reloaded.clearQuarantine('acme');
    expect(new PackageStateStore(dir).getQuarantine('acme')).toBeUndefined();
  });

  it('stores installed integrity and failure counters', () => {
    const store = new PackageStateStore(dir);
    store.setInstalled('acme', {
      version: '1.0.0', fingerprint: 'sha256:abc', files: { 'index.js': 'sha256:def' },
      installedAt: '2026-11-14T00:00:00.000Z', consecutiveFailures: 0,
    });
    store.updateInstalled('acme', { consecutiveFailures: 2 });
    expect(new PackageStateStore(dir).getInstalled('acme')).toMatchObject({
      version: '1.0.0', consecutiveFailures: 2,
    });

    store.removeInstalled('acme');
    expect(new PackageStateStore(dir).getInstalled('acme')).toBeUndefined();
  });

  it('does not leave temporary files behind after an atomic write', () => {
    const store = new PackageStateStore(dir);
    store.setDisabled('acme', true);
    store.setDisabled('beta', true);

    const leftovers = fs.readdirSync(dir).filter((name) => name !== PACKAGE_STATE_FILE);
    expect(leftovers).toEqual([]);
  });
});
