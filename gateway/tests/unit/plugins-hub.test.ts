import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listPlugins, installPlugin, setPluginEnabled, deletePlugin, HubError } from '../../src/plugins/hub';

const B64 = Buffer.from('module.exports = { name: "foo" };').toString('base64');

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

describe('installPlugin', () => {
  test('writes file, triggers reload, returns enabled entry', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'runtime', filename: 'foo.js', contentBase64: B64 });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
    expect(entry).toEqual(expect.objectContaining({ name: 'foo', status: 'enabled' }));
  });

  test('duplicate name (enabled or disabled variant) → HubError 409', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await expect(installPlugin(deps, { type: 'runtime', filename: 'foo.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('overwrite: true replaces existing file', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await installPlugin(deps, { type: 'runtime', filename: 'foo.js', contentBase64: B64, overwrite: true });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
  });

  test('path traversal rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: '../evil.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('invalid type rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'nope' as any, filename: 'a.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('oversized content rejected', async () => {
    const deps = makeDeps({ maxBytes: 4 });
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 413 });
  });

  test('invalid base64 rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', contentBase64: '!!!not-base64!!!' }))
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
