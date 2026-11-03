/**
 * Task 6 — deterministic Creator flow through the real Phase 1 package stack.
 *
 * The Creator itself has no session, draft store or REST surface of its own:
 * the source of truth is a project-local directory
 * (`<project>/.mafw/plugin-drafts/<packageName>/`) and every mutation goes
 * through the existing Phase 1 `PackageManager`/`PluginHost`. This suite pins
 * that contract end-to-end with a real manager, a real host, temporary plugin
 * and state roots, and a real fixture package (installed copy under a temp
 * `plugins/` root, `node --test` passing from the draft).
 *
 * Covered lifecycle:
 * - install a draft copy and capture revision 1;
 * - a repeated request id replays the first result (no re-read of the draft);
 * - a fresh request id after an edit advances to revision 2;
 * - a corrupted draft fails `checkPath` without touching the active revision;
 * - `remove` deletes the installed copy and keeps the source draft;
 * - the filesystem stays the only draft store: no creator-session/kv file.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../../src/config';
import { createPluginPackageContext } from '../../src/plugins/package-context';
import { PluginHost, type PluginHostOptions } from '../../src/plugins/package-host';
import { PackageManager } from '../../src/plugins/package-manager';
import { PackageStateStore } from '../../src/plugins/package-state-store';

const FIXTURE_PACKAGE = path.join(__dirname, '..', 'fixtures', 'plugin-creator', 'acme');
const PACKAGE_NAME = 'acme';
const TITLE_V1 = 'Acme Console';
const TITLE_V2 = 'Acme Console v2';

/** Sorted `/`-separated relative paths of every file below `root`. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  visit(root);
  return out.sort();
}

describe('creator draft lifecycle (deterministic)', () => {
  let base: string;
  let project: string;
  let pluginDir: string;
  let stateDir: string;
  let draft: string;
  let stateStore: PackageStateStore;
  let host: PluginHost;
  let manager: PackageManager;
  let originalConfigData: unknown;

  beforeEach(() => {
    // Captured before anything can throw so `afterEach` always restores it.
    originalConfigData = (config as any).data;
    (config as any).data = {};

    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plugin-creator-'));
    project = path.join(base, 'project');
    pluginDir = path.join(base, 'plugins');
    stateDir = path.join(base, 'state');
    draft = path.join(project, '.mafw', 'plugin-drafts', PACKAGE_NAME);
    fs.mkdirSync(draft, { recursive: true });
    fs.cpSync(FIXTURE_PACKAGE, draft, { recursive: true });

    stateStore = new PackageStateStore(stateDir);
    const options: PluginHostOptions = {
      activeRuntime: () => null,
      isDisabled: (name) => stateStore.isDisabled(name),
      canonicalTypes: new Set(['turn.completed']),
      broadcast: () => { /* sink not needed: revisions are read from the snapshot */ },
    };
    host = new PluginHost(
      pluginDir,
      (name) => createPluginPackageContext(name, { projectDir: project, gatewayPort: 3000 }),
      options,
    );
    manager = new PackageManager({ pluginDir, host, stateStore });
  });

  afterEach(() => {
    host?.stop();
    (config as any).data = originalConfigData;
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  function panelTitle(): string | undefined {
    return host.getClientSnapshot().plugins[0]?.ui.panels?.[0]?.title;
  }

  function draftIndexFile(): string {
    return path.join(draft, 'index.js');
  }

  it('ships a draft-safe fixture package whose tests pass under node --test', () => {
    // The Creator fingerprint hashes exactly what install copies: one plain
    // directory with regular files only (no `.git`, `node_modules`, symlinks,
    // temp or OS scratch files), otherwise draft approval is refused.
    expect(fs.readdirSync(FIXTURE_PACKAGE).sort()).toEqual(['acme.test.js', 'index.js', 'plugin.json']);
    for (const name of fs.readdirSync(FIXTURE_PACKAGE)) {
      const stat = fs.lstatSync(path.join(FIXTURE_PACKAGE, name));
      expect(stat.isFile()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_PACKAGE, 'plugin.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: PACKAGE_NAME, version: '1.0.0', main: 'index.js' });

    // `test` runs `node --test` with the draft as cwd; the shipped test file
    // must pass there without any dependency outside the draft.
    const run = spawnSync(process.execPath, ['--test'], { cwd: FIXTURE_PACKAGE, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/pass 1/);
  });

  it('installs, iterates, keeps the old revision on a broken check, and removes without the draft', async () => {
    await host.reload();
    expect(host.getClientSnapshot().plugins).toEqual([]);

    // 1–3: copy is already in the project draft root; install it and keep the draft.
    expect(fs.existsSync(path.join(draft, 'plugin.json'))).toBe(true);
    const first = await manager.installFromPath({ path: draft, requestId: 'creator-install-1' });
    expect(first).toMatchObject({
      name: PACKAGE_NAME,
      version: '1.0.0',
      saved: true,
      application: 'applied',
    });
    const revision1 = first.activeRevision;
    expect(revision1).toBeDefined();
    expect(host.getClientSnapshot().revision).toBe(revision1);
    expect(host.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual([PACKAGE_NAME]);
    expect(panelTitle()).toBe(TITLE_V1);
    expect(fs.existsSync(path.join(draft, 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, PACKAGE_NAME, 'plugin.json'))).toBe(true);
    // install copies the whole draft (test file included): the approval
    // fingerprint set and the install copy set are the same.
    expect(fs.existsSync(path.join(pluginDir, PACKAGE_NAME, 'acme.test.js'))).toBe(true);

    // 4: edit the draft's UI text.
    const indexFile = draftIndexFile();
    const original = fs.readFileSync(indexFile, 'utf8');
    expect(original).toContain(`const PANEL_TITLE = '${TITLE_V1}';`);
    fs.writeFileSync(indexFile, original.replace(`const PANEL_TITLE = '${TITLE_V1}';`, `const PANEL_TITLE = '${TITLE_V2}';`));

    // 5a: replaying the first request id returns the first result verbatim and
    // does not re-read the draft (without the cache this would be a 409 because
    // no `overwrite` was supplied).
    const replay = await manager.installFromPath({ path: draft, requestId: 'creator-install-1' });
    expect(replay).toEqual(first);
    expect(host.getClientSnapshot().revision).toBe(revision1);
    expect(panelTitle()).toBe(TITLE_V1);
    expect(fs.readFileSync(path.join(pluginDir, PACKAGE_NAME, 'index.js'), 'utf8')).toContain(
      `const PANEL_TITLE = '${TITLE_V1}';`,
    );

    // 5b: a new iteration uses a new request id and can advance the revision.
    // Jest keeps its own module registry; real Node evicts require.cache in the
    // Host, so resetting modules here mirrors the production reload.
    jest.resetModules();
    const second = await manager.installFromPath({
      path: draft,
      overwrite: true,
      requestId: 'creator-install-2',
    });
    expect(second).toMatchObject({ name: PACKAGE_NAME, saved: true, application: 'applied' });
    expect(second.activeRevision).toBeDefined();
    expect(second.activeRevision).not.toBe(revision1);
    expect(host.getClientSnapshot().revision).toBe(second.activeRevision);
    expect(panelTitle()).toBe(TITLE_V2);

    // 6: a broken candidate never replaces the active revision.
    const good = await manager.checkPath(draft);
    expect(good).toMatchObject({ ok: true, name: PACKAGE_NAME, version: '1.0.0' });
    // Same jest module-registry shim as above: the Host evicts require.cache,
    // here the registry must be reset so the corrupted file is read.
    jest.resetModules();
    fs.writeFileSync(indexFile, 'module.exports = {\n');
    const check = await manager.checkPath(draft);
    expect(check.ok).toBe(false);
    expect(check.error).toBeTruthy();
    expect(host.getClientSnapshot().revision).toBe(second.activeRevision);
    expect(panelTitle()).toBe(TITLE_V2);
    expect(host.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual([PACKAGE_NAME]);

    // 7: remove drops the installed copy and everything it contributed, but the
    // project draft is the source and survives.
    const removed = await manager.remove(PACKAGE_NAME);
    expect(removed).toMatchObject({ name: PACKAGE_NAME, saved: true });
    expect(fs.existsSync(path.join(pluginDir, PACKAGE_NAME))).toBe(false);
    expect(fs.readdirSync(pluginDir)).toEqual([]);
    expect(host.getClientSnapshot().plugins).toEqual([]);
    expect(fs.existsSync(path.join(draft, 'plugin.json'))).toBe(true);
    expect(fs.existsSync(indexFile)).toBe(true);

    // 8: the filesystem is the draft store. Inside the project the flow wrote
    // nothing but the draft itself, so no creator-session/draft kv can exist.
    expect(walkFiles(project)).toEqual([
      `.mafw/plugin-drafts/${PACKAGE_NAME}/acme.test.js`,
      `.mafw/plugin-drafts/${PACKAGE_NAME}/index.js`,
      `.mafw/plugin-drafts/${PACKAGE_NAME}/plugin.json`,
    ]);
    const everything = walkFiles(base);
    expect(everything.filter((file) => /creator/i.test(path.basename(file)))).toEqual([]);
    expect(everything.filter((file) => /\.(db|sqlite|sqlite3)$/i.test(file))).toEqual([]);
  });
});
