import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listPlugins, installPlugin, setPluginEnabled, deletePlugin, cleanupExamples, HubError } from '../../src/plugins/hub';

const mod = (body: string) => Buffer.from(body, 'utf-8');
const PLAIN = mod('module.exports = { name: "foo" };');
const RUNTIME_MOD = mod('module.exports = { name: "my-rt", createRuntime: async () => ({}) };');
const MEDIA_MOD = mod('module.exports = { name: "my-media", createPrompt: async () => async () => "" };');
const USAGE_MOD = mod('module.exports = { name: "my-usage", type: "api", fetch: async () => null };');
const UI_MOD = mod('module.exports = { name: "my-ui", tools: { t: { render: () => [] } } };');
const AMBIGUOUS_MOD = mod('module.exports = { name: "both", createPrompt: async () => async () => "", fetch: async () => null };');

function makeDeps(overrides: Record<string, any> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-'));
  const dirs = {
    runtime: path.join(root, 'runtime-plugins'),
    media: path.join(root, 'media-plugins'),
    usage: path.join(root, 'usage-plugins'),
    ui: path.join(root, 'ui-plugins'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return {
    dirs,
    getErrors: jest.fn(() => ({} as Record<string, string>)),
    configDisabledUsage: jest.fn(() => new Set<string>()),
    reload: jest.fn(),
    ...overrides,
  };
}

describe('listPlugins', () => {
  test('empty dirs yield no entries', () => {
    expect(listPlugins(makeDeps())).toEqual([]);
  });

  test('foo.js is enabled, foo.js.disabled is disabled', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    fs.writeFileSync(path.join(deps.dirs.media, 'bar.js.disabled'), 'x');
    const entries = listPlugins(deps);
    expect(entries).toEqual([
      expect.objectContaining({ type: 'runtime', name: 'foo', file: 'foo.js', status: 'enabled' }),
      expect.objectContaining({ type: 'media', name: 'bar', file: 'bar.js.disabled', status: 'disabled' }),
    ]);
  });

  test('entries carry size and mtime', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), '12345');
    const [e] = listPlugins(deps);
    expect(e.size).toBe(5);
    expect(new Date(e.mtime).getTime()).not.toBeNaN();
  });

  test('loader errors promote status to error', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    (deps.getErrors as jest.Mock).mockImplementation((type: string) =>
      type === 'runtime' ? { foo: 'boom' } : {});
    expect(listPlugins(deps)[0]).toEqual(expect.objectContaining({ status: 'error', error: 'boom' }));
  });

  test('usage plugin in config disabledPlugins shows config-disabled', () => {
    const deps = makeDeps({ configDisabledUsage: () => new Set(['foo']) });
    fs.writeFileSync(path.join(deps.dirs.usage, 'foo.js'), 'x');
    expect(listPlugins(deps)[0]).toEqual(expect.objectContaining({ status: 'config-disabled' }));
  });

  test('same name enabled+disabled coexisting: enabled wins with warning error field', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js.disabled'), 'x');
    const entries = listPlugins(deps);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(expect.objectContaining({ status: 'enabled' }));
    expect(entries[0].error).toContain('foo.js.disabled');
  });

  test('builtin entries are listed first with builtin flag', () => {
    const deps = makeDeps({
      builtinEntries: () => [
        { type: 'runtime', name: 'opencode', file: '(builtin)', status: 'enabled', size: 0, mtime: '' },
        { type: 'runtime', name: 'pi', file: '(builtin)', status: 'enabled', size: 0, mtime: '' },
        { type: 'media', name: 'pi', file: '(builtin)', status: 'enabled', size: 0, mtime: '' },
        { type: 'usage', name: 'deepseek', file: 'deepseek.js', status: 'enabled', size: 0, mtime: '', pluginType: 'api' },
      ],
    });
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    const entries = listPlugins(deps);
    expect(entries.map((e) => `${e.type}/${e.name}`)).toEqual([
      'runtime/opencode', 'runtime/pi', 'media/pi', 'usage/deepseek', 'runtime/foo',
    ]);
    expect(entries[0]).toEqual(expect.objectContaining({ builtin: true, size: 0, mtime: '' }));
  });

  test('user file with same name marks builtin overridden', () => {
    const deps = makeDeps({
      builtinEntries: () => [
        { type: 'usage', name: 'deepseek', file: 'deepseek.js', status: 'enabled', size: 0, mtime: '', pluginType: 'api' },
      ],
    });
    fs.writeFileSync(path.join(deps.dirs.usage, 'deepseek.js'), 'user copy');
    const entries = listPlugins(deps);
    const builtin = entries.find((e) => e.builtin)!;
    expect(builtin.overridden).toBe(true);
    const user = entries.find((e) => !e.builtin)!;
    expect(user).toEqual(expect.objectContaining({ name: 'deepseek', status: 'enabled' }));
  });

  test('usage builtin in config disabledPlugins shows config-disabled', () => {
    const deps = makeDeps({
      builtinEntries: () => [
        { type: 'usage', name: 'deepseek', file: 'deepseek.js', status: 'enabled', size: 0, mtime: '' },
      ],
      configDisabledUsage: () => new Set(['deepseek']),
    });
    const [builtin] = listPlugins(deps);
    expect(builtin).toEqual(expect.objectContaining({ status: 'config-disabled', builtin: true }));
  });

  test('no builtinEntries dep → unchanged behavior', () => {
    expect(listPlugins(makeDeps())).toEqual([]);
  });
});

describe('cleanupExamples', () => {
  test('removes example.js.disabled in all four dirs', () => {
    const deps = makeDeps();
    for (const d of Object.values(deps.dirs)) fs.writeFileSync(path.join(d, 'example.js.disabled'), 'x');
    const out = cleanupExamples(deps);
    expect(out.removed).toHaveLength(4);
    expect(out.failed).toEqual([]);
    for (const d of Object.values(deps.dirs)) expect(fs.existsSync(path.join(d, 'example.js.disabled'))).toBe(false);
  });

  test('idempotent on missing files/dirs and keeps other files', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'README.md'), 'keep');
    const out = cleanupExamples(deps);
    expect(out.removed).toEqual([]);
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'README.md'))).toBe(true);
  });

  test('failed unlink is reported not thrown', () => {
    const deps = makeDeps();
    // directory named example.js.disabled → unlinkSync throws (EPERM/EISDIR) on all platforms
    fs.mkdirSync(path.join(deps.dirs.ui, 'example.js.disabled'));
    const out = cleanupExamples(deps);
    expect(out.failed).toHaveLength(1);
    expect(out.removed).toHaveLength(0);
  });
});

describe('installPlugin', () => {
  test('writes raw bytes, triggers reload, returns enabled entry', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'runtime', filename: 'foo.js', bytes: PLAIN });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
    expect(entry).toEqual(expect.objectContaining({ name: 'foo', status: 'enabled' }));
  });

  test('sniffs runtime interface', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { filename: 'rt.js', bytes: RUNTIME_MOD });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'rt.js'))).toBe(true);
    expect(entry.type).toBe('runtime');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
  });

  test('sniffs media interface (createPrompt / engine / modalities)', async () => {
    const deps = makeDeps();
    const e1 = await installPlugin(deps, { filename: 'm1.js', bytes: MEDIA_MOD });
    expect(e1.type).toBe('media');
    const e2 = await installPlugin(deps, { filename: 'm2.js', bytes: mod('module.exports = { engine: "pi" };') });
    expect(e2.type).toBe('media');
    const e3 = await installPlugin(deps, { filename: 'm3.js', bytes: mod('module.exports = { modalities: ["image"] };') });
    expect(e3.type).toBe('media');
  });

  test('sniffs usage interface (fetch; type optional)', async () => {
    const deps = makeDeps();
    const e1 = await installPlugin(deps, { filename: 'u1.js', bytes: USAGE_MOD });
    expect(e1.type).toBe('usage');
    const e2 = await installPlugin(deps, { filename: 'u2.js', bytes: mod('module.exports = { fetch: async () => null };') });
    expect(e2.type).toBe('usage');
  });

  test('sniffs ui interface (tools object)', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { filename: 'ui.js', bytes: UI_MOD });
    expect(entry.type).toBe('ui');
  });

  test('unrecognized interface → 400 and no file left behind', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'x.js', bytes: mod('module.exports = { name: "x" };') }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('unrecognized plugin interface') });
    for (const d of Object.values(deps.dirs)) {
      expect(fs.readdirSync(d).filter((f) => f.endsWith('.js') || f.endsWith('.tmp'))).toEqual([]);
    }
  });

  test('ambiguous interface → 400 with candidates', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'x.js', bytes: AMBIGUOUS_MOD }))
      .rejects.toMatchObject({ status: 400, message: 'ambiguous plugin interface: media/usage' });
  });

  test('explicit type skips sniffing', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'ui', filename: 'weird.js', bytes: mod('module.exports = { name: "weird" };') });
    expect(fs.existsSync(path.join(deps.dirs.ui, 'weird.js'))).toBe(true);
    expect(entry.type).toBe('ui');
  });

  test('duplicate name (enabled or disabled variant) → HubError 409', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await expect(installPlugin(deps, { type: 'runtime', filename: 'foo.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('overwrite: true replaces existing file', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await installPlugin(deps, { type: 'runtime', filename: 'foo.js', bytes: PLAIN, overwrite: true });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
  });

  test('path traversal rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: '../evil.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('invalid type rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'nope' as any, filename: 'a.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('oversized content rejected (raw bytes)', async () => {
    const deps = makeDeps({ maxBytes: 4 });
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 413 });
  });

  test('empty bytes rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', bytes: Buffer.alloc(0) }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('setPluginEnabled / deletePlugin', () => {
  test('disable renames to .disabled and triggers reload', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js', enabled: false });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(false);
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js.disabled'))).toBe(true);
    expect(entry.status).toBe('disabled');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
  });

  test('enable renames back', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js.disabled'), 'x');
    const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js.disabled', enabled: true });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(true);
    expect(entry.status).toBe('enabled');
  });

  test('operating on a missing file → HubError 404', async () => {
    const deps = makeDeps();
    await expect(setPluginEnabled(deps, { type: 'runtime', filename: 'nope.js', enabled: false }))
      .rejects.toMatchObject({ status: 404 });
    await expect(deletePlugin(deps, { type: 'runtime', filename: 'nope.js' }))
      .rejects.toMatchObject({ status: 404 });
  });

  // ── stale client snapshot: toggle double-click / unrefreshed list sends the
  // opposite-state filename; server must resolve the on-disk variant instead
  // of 404ing (this is the "激活 not found" bug).
  describe('idempotency against stale filenames', () => {
    test('enable with plain name resolves .js.disabled variant on disk', async () => {
      const deps = makeDeps();
      fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js.disabled'), 'x');
      const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js', enabled: true });
      expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(true);
      expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js.disabled'))).toBe(false);
      expect(entry.status).toBe('enabled');
    });

    test('disable with .disabled name resolves plain .js variant on disk', async () => {
      const deps = makeDeps();
      fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
      const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js.disabled', enabled: false });
      expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js.disabled'))).toBe(true);
      expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(false);
      expect(entry.status).toBe('disabled');
    });

    test('rapid double toggle with same stale name still lands disabled', async () => {
      const deps = makeDeps();
      fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
      // Two clicks before the list refreshes: both carry foo.js (enabled snapshot).
      await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js', enabled: false });
      const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js', enabled: false });
      expect(entry.status).toBe('disabled');
      expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js.disabled'))).toBe(true);
    });

    test('still 404 when neither variant exists', async () => {
      const deps = makeDeps();
      await expect(setPluginEnabled(deps, { type: 'runtime', filename: 'nope.js', enabled: true }))
        .rejects.toMatchObject({ status: 404 });
    });
  });

  test('delete removes the file and triggers reload', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    await deletePlugin(deps, { type: 'runtime', filename: 'foo.js' });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(false);
    expect(deps.reload).toHaveBeenCalledWith('runtime');
  });

  test('traversal in enable/delete rejected', async () => {
    const deps = makeDeps();
    await expect(setPluginEnabled(deps, { type: 'runtime', filename: 'sub/../../x.js', enabled: false }))
      .rejects.toMatchObject({ status: 400 });
    await expect(deletePlugin(deps, { type: 'ui', filename: '..\\evil.js' }))
      .rejects.toMatchObject({ status: 400 });
  });
});
