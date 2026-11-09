import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import {
  pluginWebAssetContentType,
  resolvePluginWebEntry,
  validatePluginWebSurfaces,
} from '../../../src/plugins/plugin-web-assets';

const TMP_DIRS: string[] = [];

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP_DIRS.push(dir);
  return dir;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Directory package (`plugin.json` + `index.js`) with an optional `web/` tree. */
function writePackage(
  root: string,
  name: string,
  activateBody: string,
  webFiles: Record<string, string> = {},
): string {
  const pkgDir = path.join(root, name);
  writeFile(path.join(pkgDir, 'plugin.json'), JSON.stringify({ name }));
  writeFile(
    path.join(pkgDir, 'index.js'),
    `module.exports = { name: '${name}', async activate() { ${activateBody} } };`,
  );
  for (const [relative, content] of Object.entries(webFiles)) {
    writeFile(path.join(pkgDir, 'web', relative), content);
  }
  return pkgDir;
}

function mkHost(pluginsDir: string): PluginHost {
  return new PluginHost(pluginsDir, (name, bag) =>
    createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000, bag }),
  );
}

afterAll(() => {
  for (const dir of TMP_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

describe('plugin web asset resolution', () => {
  it('resolves nested entries and defaults a missing entry to index.html', () => {
    const pkgDir = mkTmp('mafw-web-');
    writeFile(path.join(pkgDir, 'web', 'index.html'), '<html></html>');
    writeFile(path.join(pkgDir, 'web', 'app', 'index.html'), '<html></html>');

    expect(resolvePluginWebEntry(pkgDir, 'app/index.html')).toBe(
      fs.realpathSync(path.join(pkgDir, 'web', 'app', 'index.html')),
    );
    expect(validatePluginWebSurfaces(pkgDir, [{ id: 'main', title: 'Main', entry: 'app/index.html' }]))
      .toEqual([]);
    expect(validatePluginWebSurfaces(pkgDir, [{ id: 'main', title: 'Main' }])).toEqual([]);
  });

  it('rejects a surface whose entry escapes web/', () => {
    const pkgDir = mkTmp('mafw-web-');
    writeFile(path.join(pkgDir, 'web', 'index.html'), '<html></html>');
    // Same file name outside web/: containment must reject it even though the
    // resolved path exists.
    writeFile(path.join(pkgDir, 'index.html'), '<html></html>');

    const errors = validatePluginWebSurfaces(pkgDir, [
      { id: 'p', title: 'P', entry: '../index.html' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"p"');
    expect(errors[0]).toContain('../index.html');
    expect(resolvePluginWebEntry(pkgDir, '../index.html')).toBeNull();
  });

  it('rejects absolute paths, dotfiles and unreadable entries', () => {
    const pkgDir = mkTmp('mafw-web-');
    writeFile(path.join(pkgDir, 'web', 'index.html'), '<html></html>');
    writeFile(path.join(pkgDir, 'web', '.env'), 'SECRET=1');
    writeFile(path.join(pkgDir, 'web', '.hidden', 'page.html'), '<html></html>');

    expect(resolvePluginWebEntry(pkgDir, '/index.html')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, 'C:/Windows/win.ini')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, 'index.html\0.png')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, '.env')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, '.hidden/page.html')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, 'missing.html')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, '')).toBeNull();
    expect(resolvePluginWebEntry(pkgDir, 'app//index.html')).toBeNull();
  });

  it('rejects a link inside web/ that points outside it', () => {
    const pkgDir = mkTmp('mafw-web-');
    writeFile(path.join(pkgDir, 'web', 'index.html'), '<html></html>');
    const outside = path.join(pkgDir, 'outside');
    writeFile(path.join(outside, 'secret.html'), 'secret');
    try {
      // Junctions need no privilege on Windows; `'junction'` is ignored on POSIX.
      fs.symlinkSync(outside, path.join(pkgDir, 'web', 'escape'), 'junction');
    } catch {
      // Restricted environment without link support: the containment rule is
      // still covered by the `../` and realpath cases above.
      return;
    }

    expect(resolvePluginWebEntry(pkgDir, 'escape/secret.html')).toBeNull();
    expect(
      validatePluginWebSurfaces(pkgDir, [{ id: 'p', title: 'P', entry: 'escape/secret.html' }]),
    ).toHaveLength(1);
  });

  it('maps asset extensions to content types and rejects unknown ones', () => {
    expect(pluginWebAssetContentType('/x/index.html')).toContain('text/html');
    expect(pluginWebAssetContentType('/x/app.JS')).toContain('text/javascript');
    expect(pluginWebAssetContentType('/x/app.css')).toContain('text/css');
    expect(pluginWebAssetContentType('/x/data.json')).toContain('application/json');
    expect(pluginWebAssetContentType('/x/icon.svg')).toContain('image/svg+xml');
    expect(pluginWebAssetContentType('/x/icon.png')).toBe('image/png');
    expect(pluginWebAssetContentType('/x/icon.jpg')).toBe('image/jpeg');
    expect(pluginWebAssetContentType('/x/icon.webp')).toBe('image/webp');
    expect(pluginWebAssetContentType('/x/font.woff2')).toBe('font/woff2');
    expect(pluginWebAssetContentType('/x/font.woff')).toBe('font/woff');
    expect(pluginWebAssetContentType('/x/font.ttf')).toBe('font/ttf');
    expect(pluginWebAssetContentType('/x/icon.ico')).toBe('image/x-icon');
    expect(pluginWebAssetContentType('/x/module.wasm')).toBe('application/wasm');
    expect(pluginWebAssetContentType('/x/app.js.map')).toContain('application/json');
    // Unknown extensions are not silently served as text/plain.
    expect(pluginWebAssetContentType('/x/blob.bin')).toBeNull();
  });
});

describe('PluginHost web surface activation', () => {
  let dir: string;
  let host: PluginHost | undefined;

  beforeEach(() => {
    dir = mkTmp('mafw-web-host-');
  });

  afterEach(() => {
    host?.stop();
    host = undefined;
  });

  it('fails the whole package when a declared entry is missing', async () => {
    writePackage(
      dir,
      'webpkg',
      `return { ui: { webSurfaces: [{ id: 'main', title: 'Main', entry: 'app/index.html' }] } };`,
      // Only the default entry exists: the declared one must still be checked.
      { 'index.html': '<html></html>' },
    );
    host = mkHost(dir);
    await host.init();

    const state = host.getState().find((entry) => entry.name === 'webpkg');
    expect(state).toMatchObject({ status: 'error' });
    expect(state?.error).toContain('web surface "main"');
    expect(state?.error).toContain('app/index.html');
    // Fail-closed: a package with an unreadable surface is not published.
    expect(host.getClientSnapshot().plugins).toHaveLength(0);
  });

  it('activates a package whose entries resolve under web/', async () => {
    writePackage(
      dir,
      'webpkg',
      `return { ui: { webSurfaces: [{ id: 'main', title: 'Main', entry: 'app/index.html' }] } };`,
      { 'app/index.html': '<html></html>', 'app/app.js': 'console.log(1)' },
    );
    host = mkHost(dir);
    await host.init();

    const state = host.getState().find((entry) => entry.name === 'webpkg');
    expect(state).toMatchObject({ status: 'ok' });
    expect(state?.contributions).toContain('ui');
    const plugin = host.getClientSnapshot().plugins.find((entry) => entry.name === 'webpkg');
    expect(plugin?.ui?.webSurfaces?.[0]).toMatchObject({
      id: 'main',
      entry: 'app/index.html',
      url: '/api/plugins/webpkg/ui/app/index.html',
    });
  });

  it('rejects web surfaces declared by a single-file package', async () => {
    writeFile(
      path.join(dir, 'solo.js'),
      `module.exports = { name: 'solo', async activate() {
        return { ui: { webSurfaces: [{ id: 'main', title: 'Main' }] } };
      } };`,
    );
    host = mkHost(dir);
    await host.init();

    const state = host.getState().find((entry) => entry.name === 'solo');
    expect(state).toMatchObject({ status: 'error' });
    expect(state?.error).toContain('single-file');
    expect(host.getClientSnapshot().plugins).toHaveLength(0);
  });

  it('runs the check for offline checkPackage dry runs too', async () => {
    const candidateRoot = mkTmp('mafw-web-check-');
    const broken = writePackage(
      candidateRoot,
      'broken',
      `return { ui: { webSurfaces: [{ id: 'main', title: 'Main' }] } };`,
    );
    const good = writePackage(
      candidateRoot,
      'good',
      `return { ui: { webSurfaces: [{ id: 'main', title: 'Main' }] } };`,
      { 'index.html': '<html></html>' },
    );
    host = mkHost(dir);
    await host.init();

    const rejected = await host.checkPackage(broken);
    expect(rejected).toMatchObject({ ok: false, name: 'broken' });
    expect(rejected.error).toContain('web surface "main"');

    await expect(host.checkPackage(good)).resolves.toMatchObject({ ok: true, name: 'good' });
  });
});
