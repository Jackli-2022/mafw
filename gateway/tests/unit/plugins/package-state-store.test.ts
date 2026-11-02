import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageStateStore, PACKAGE_STATE_FILE } from '../../../src/plugins/package-state-store';

describe('PackageStateStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pkg-state-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty document when the state file is missing', () => {
    const store = new PackageStateStore(dir);
    expect(store.read()).toEqual({ version: 1, disabled: [] });
    expect(store.isDisabled('acme')).toBe(false);
  });

  it('persists a disabled package across store instances', () => {
    const store = new PackageStateStore(dir);
    store.setDisabled('acme', true);

    expect(fs.existsSync(path.join(dir, PACKAGE_STATE_FILE))).toBe(true);
    expect(store.isDisabled('acme')).toBe(true);

    const reloaded = new PackageStateStore(dir);
    expect(reloaded.read()).toEqual({ version: 1, disabled: ['acme'] });
    expect(reloaded.isDisabled('acme')).toBe(true);
    expect(reloaded.isDisabled('other')).toBe(false);
  });

  it('removes the entry when a package is enabled again', () => {
    const store = new PackageStateStore(dir);
    store.setDisabled('acme', true);
    store.setDisabled('beta', true);
    store.setDisabled('acme', false);

    expect(new PackageStateStore(dir).read()).toEqual({ version: 1, disabled: ['beta'] });
    // Enabling a package that was never disabled is a no-op.
    store.setDisabled('beta', false);
    store.setDisabled('beta', false);
    expect(new PackageStateStore(dir).read()).toEqual({ version: 1, disabled: [] });
  });

  it('creates missing parent directories when persisting', () => {
    const nested = path.join(dir, 'nested', 'deeper');
    const store = new PackageStateStore(nested);
    store.setDisabled('acme', true);

    expect(fs.existsSync(path.join(nested, PACKAGE_STATE_FILE))).toBe(true);
    expect(new PackageStateStore(nested).isDisabled('acme')).toBe(true);
  });

  it('fails open on malformed state and repairs it on the next write', () => {
    fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE), '{ not json');
    const store = new PackageStateStore(dir);
    expect(store.read()).toEqual({ version: 1, disabled: [] });
    expect(store.isDisabled('acme')).toBe(false);

    store.setDisabled('acme', true);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, PACKAGE_STATE_FILE), 'utf-8'));
    expect(parsed).toEqual({ version: 1, disabled: ['acme'] });
  });

  it('drops non-string entries from a hand-edited state file', () => {
    fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE), JSON.stringify({
      version: 1,
      disabled: ['acme', 42, '', null, '../escape'],
    }));
    const store = new PackageStateStore(dir);
    expect(store.read().disabled).toEqual(['acme']);
  });

  it('does not leave temporary files behind after an atomic write', () => {
    const store = new PackageStateStore(dir);
    store.setDisabled('acme', true);
    store.setDisabled('beta', true);

    const leftovers = fs.readdirSync(dir).filter((name) => name !== PACKAGE_STATE_FILE);
    expect(leftovers).toEqual([]);
  });
});
