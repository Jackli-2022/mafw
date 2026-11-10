/**
 * Task 5: host services `ctx.files` / `ctx.terminal`.
 *
 * Scope contract (controller ruling overrides the plan's interface block):
 *  - the package context is package-scoped, but every file/terminal access is
 *    scoped by an explicit ticket-bound project directory, never `ctx.projectDir`
 *    (the gateway launch directory);
 *  - `ctx.files` is read-only and cannot leave the root via `..`, absolute
 *    paths, dotfiles or symlinks;
 *  - `ctx.terminal` only touches PTYs it created for this package/activation and
 *    closes them when the activation bag disposes (reload/disable/remove/stop).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WebSocket } from 'ws';
import type { RuntimePtyChannel } from '../../../src/runtime/pty';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import { createRegistrationBag } from '../../../src/plugins/registration-bag';
import {
  DEFAULT_PLUGIN_READ_MAX_BYTES,
  createPluginFilesApi,
  createPluginTerminalApi,
} from '../../../src/plugins/plugin-host-services';
import { PluginHost, type PluginHostOptions } from '../../../src/plugins/package-host';
import {
  TerminalService,
  type TerminalNativeSocket,
  type TerminalSocket,
} from '../../../src/terminal/terminal-service';

/* ------------------------------------------------------------------ helpers */

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root: string, rel: string, content: string | Buffer = ''): string {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

class FakeClientSocket implements TerminalSocket {
  sent: any[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  on(event: 'message' | 'close' | 'error', cb: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

class FakeNativeSocket implements TerminalNativeSocket {
  readyState = 1;
  sent: unknown[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  on(event: 'open' | 'message' | 'close' | 'error', cb: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

function fakePtyRuntime() {
  const calls = {
    created: [] as any[],
    connected: [] as any[],
    resized: [] as any[],
    removed: [] as any[],
  };
  let counter = 0;
  const channel: RuntimePtyChannel = {
    async create(opts) {
      calls.created.push(opts);
      counter += 1;
      return { id: `pty_${counter}` };
    },
    async connect(opts) {
      calls.connected.push(opts);
      return { url: `ws://127.0.0.1:4096/api/pty/${opts.id}/connect?ticket=native` };
    },
    async resize(opts) {
      calls.resized.push(opts);
    },
    async remove(opts) {
      calls.removed.push(opts);
    },
  };
  return { runtime: { pty: channel }, calls };
}

function serviceWith(runtime: { pty?: RuntimePtyChannel } | null) {
  const natives: FakeNativeSocket[] = [];
  const service = new TerminalService({
    getRuntime: () => runtime,
    openNative: () => {
      const native = new FakeNativeSocket();
      natives.push(native);
      return native;
    },
  });
  return { service, natives };
}

/**
 * Writes a package whose `activate()` creates one PTY (recorded in
 * `globalThis.__mafwPtyIds`) and exposes it through a `resize` action, so a test
 * can prove which revision still owns the session after a revision swap.
 * Only the trailing marker changes between revisions: the body is identical,
 * which is enough to change the fingerprint and force a new activation.
 */
function writePtyPackage(dir: string, marker: string, withRuntime = false): void {
  const runtimeBlock = withRuntime
    ? `\n    runtime: { name: 'term', async createRuntime() { return { name: 'term', capabilities: {} }; } },`
    : '';
  fs.writeFileSync(path.join(dir, 'term.js'), `
module.exports = { name: 'term', async activate(ctx) {
  const g = globalThis;
  const created = await ctx.terminal.create({ projectDir: g.__mafwPtyProject });
  g.__mafwPtyIds = g.__mafwPtyIds || [];
  g.__mafwPtyIds.push(created.id);
  return {
    actions: {
      resize: { handler: async () => { ctx.terminal.resize(created.id, 80, 24); return { id: created.id }; } },
    },${runtimeBlock}
  };
} };
// ${marker}
`);
}

/* -------------------------------------------------------------------- files */

describe('ctx.files (read-only, project-root contained)', () => {
  let root: string;

  beforeEach(() => {
    root = mkTmpDir('mafw-files-');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the project root dirs-first with size and mtime', async () => {
    write(root, 'b.txt', 'bb');
    write(root, 'a.txt', 'a');
    write(root, 'zdir/keep.txt');
    write(root, 'adir/keep.txt');
    write(root, '.env', 'SECRET=1');

    const api = createPluginFilesApi();
    const entries = await api.list(root, '.');

    expect(entries.map((entry) => entry.name)).toEqual(['adir', 'zdir', 'a.txt', 'b.txt']);
    expect(entries[0]).toMatchObject({ name: 'adir', kind: 'dir' });
    expect(entries[2]).toMatchObject({ name: 'a.txt', kind: 'file', size: 1 });
    for (const entry of entries) {
      expect(typeof entry.mtime).toBe('number');
      expect(entry.mtime).toBeGreaterThan(0);
    }
    // Dot entries are never exposed by a listing.
    expect(entries.some((entry) => entry.name === '.env')).toBe(false);
  });

  it('rejects traversal, absolute paths and dotfiles', async () => {
    write(root, 'inside.txt', 'ok');
    const outside = mkTmpDir('mafw-outside-');
    write(outside, 'secret.txt', 'no');
    const api = createPluginFilesApi();

    try {
      await expect(api.read(root, '../secret.txt')).rejects.toThrow(/traversal/);
      await expect(api.read(root, 'nested/../../secret.txt')).rejects.toThrow(/traversal/);
      await expect(api.list(root, '..')).rejects.toThrow(/traversal/);
      await expect(api.stat(root, path.join(root, 'inside.txt'))).rejects.toThrow(/absolute/);
      await expect(api.read(root, path.join(outside, 'secret.txt'))).rejects.toThrow(/absolute/);
      await expect(api.read(root, '.env')).rejects.toThrow(/dotfile/);
      await expect(api.read(root, 'nested/.git/config')).rejects.toThrow(/dotfile/);
      await expect(api.list(root, '.git')).rejects.toThrow(/dotfile/);
      // The legitimate path still works after every rejection.
      expect((await api.read(root, 'inside.txt')).toString()).toBe('ok');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses symlinks that resolve outside the project root', async () => {
    const outside = mkTmpDir('mafw-link-target-');
    write(outside, 'secret.txt', 'no');
    write(root, 'inside.txt', 'ok');
    const escape = path.join(root, 'escape');
    let linked = true;
    try {
      fs.symlinkSync(outside, escape, 'junction');
    } catch {
      linked = false; // Windows without junction/symlink support
    }
    if (!linked) {
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }

    try {
      const api = createPluginFilesApi();
      await expect(api.read(root, 'escape/secret.txt')).rejects.toThrow(/escapes the project root/);
      await expect(api.stat(root, 'escape')).rejects.toThrow(/escapes the project root/);
      // Listing must not leak the escaping entry either.
      expect((await api.list(root, '.')).some((entry) => entry.name === 'escape')).toBe(false);

      // A link that stays inside the root is followed normally.
      const inner = path.join(root, 'inner-link');
      fs.symlinkSync(path.join(root, 'inside.txt'), inner, 'file');
      expect((await api.read(root, 'inner-link')).toString()).toBe('ok');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('caps reads at 8 MiB by default and honours an explicit maxBytes', async () => {
    write(root, 'big.txt', '0123456789');
    const api = createPluginFilesApi();

    expect(DEFAULT_PLUGIN_READ_MAX_BYTES).toBe(8 * 1024 * 1024);
    await expect(api.read(root, 'big.txt', { maxBytes: 4 })).rejects.toThrow(/exceeds 4 bytes/);
    expect((await api.read(root, 'big.txt', { maxBytes: 10 })).toString()).toBe('0123456789');
    await expect(api.read(root, 'big.txt', { maxBytes: 0 })).rejects.toThrow(/maxBytes/);
    await expect(api.read(root, 'big.txt', { maxBytes: 1.5 })).rejects.toThrow(/maxBytes/);
    expect((await api.read(root, 'big.txt')).toString()).toBe('0123456789');
  });

  it('stats files and directories and rejects non-files for read', async () => {
    write(root, 'data/inner.txt', 'abcd');
    const api = createPluginFilesApi();

    expect(await api.stat(root, 'data/inner.txt')).toMatchObject({ kind: 'file', size: 4 });
    const dir = await api.stat(root, 'data');
    expect(dir.kind).toBe('dir');
    expect(dir.size).toBe(0);
    expect(typeof dir.mtime).toBe('number');

    await expect(api.read(root, 'data')).rejects.toThrow(/not a file/);
    await expect(api.stat(root, 'missing.txt')).rejects.toThrow(/not found/);
  });

  it('requires an absolute project directory that exists', async () => {
    write(root, 'file.txt', 'x');
    const api = createPluginFilesApi();
    const missing = path.join(root, 'nope');

    await expect(api.list('relative/dir', '.')).rejects.toThrow(/absolute/);
    await expect(api.list(missing, '.')).rejects.toThrow(/not found/);
    await expect(api.list(path.join(root, 'file.txt'), '.')).rejects.toThrow(/not a directory/);
    await expect(api.list(root, 42 as unknown as string)).rejects.toThrow(/string/);
  });
});

/* ----------------------------------------------------------------- terminal */

describe('ctx.terminal (per-package PTY tracking)', () => {
  it('creates under the passed project directory and tracks per package', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const a = createPluginTerminalApi({ pkg: 'pkg-create', service: () => service });
    const b = createPluginTerminalApi({ pkg: 'pkg-other', service: () => service });

    const projectA = '/projects/a';
    const projectB = '/projects/b';
    const createdA = await a.create({ projectDir: projectA, cols: 100, rows: 40 });
    const createdB = await b.create({ projectDir: projectB });

    expect(createdA).toEqual({ id: 'pty_1' });
    expect(calls.created[0]).toMatchObject({ directory: projectA, cols: 100, rows: 40 });
    expect(calls.created[1]).toMatchObject({ directory: projectB });

    await a.dispose();
    expect(calls.removed).toEqual([{ id: createdA.id, directory: projectA }]);

    // Package B's PTY is untouched by A's retire.
    await b.bridge(createdB.id, new FakeClientSocket() as unknown as WebSocket);
    expect(calls.connected).toEqual([{ id: createdB.id, directory: projectB }]);
    await b.dispose();
    expect(calls.removed).toEqual([
      { id: createdA.id, directory: projectA },
      { id: createdB.id, directory: projectB },
    ]);
  });

  it('re-arms after dispose and stays idempotent across repeated disposals', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const api = createPluginTerminalApi({ pkg: 'pkg-rearm', service: () => service });

    const first = await api.create({ projectDir: '/p' });
    await api.dispose();
    await api.dispose();
    expect(calls.removed).toEqual([{ id: first.id, directory: '/p' }]);

    const second = await api.create({ projectDir: '/p' });
    expect(second.id).not.toBe(first.id);
    await api.dispose();
    expect(calls.removed).toEqual([
      { id: first.id, directory: '/p' },
      { id: second.id, directory: '/p' },
    ]);
  });

  it('never bridges, resizes or kills a PTY it did not create', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const owner = createPluginTerminalApi({ pkg: 'pkg-owner', service: () => service });
    const intruder = createPluginTerminalApi({ pkg: 'pkg-intruder', service: () => service });
    const owned = await owner.create({ projectDir: '/owner' });

    await expect(
      intruder.bridge(owned.id, new FakeClientSocket() as unknown as WebSocket),
    ).rejects.toThrow(/not owned by this package/);
    expect(calls.connected).toEqual([]);
    expect(() => intruder.resize(owned.id, 80, 24)).toThrow(/not owned by this package/);
    expect(calls.resized).toEqual([]);
    intruder.kill(owned.id); // idempotent no-op, never reaches the runtime
    expect(calls.removed).toEqual([]);

    await owner.dispose();
    expect(calls.removed).toEqual([{ id: owned.id, directory: '/owner' }]);
  });

  it('issues its own ticket and pipes runtime frames to the plugin websocket', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service, natives } = serviceWith(runtime);
    const api = createPluginTerminalApi({ pkg: 'pkg-bridge', service: () => service });
    const { id } = await api.create({ projectDir: '/projects/a' });
    const client = new FakeClientSocket();

    await api.bridge(id, client as unknown as WebSocket);

    expect(calls.connected).toEqual([{ id, directory: '/projects/a' }]);
    const native = natives[0];
    native.emit('message', 'hello terminal');
    expect(client.sent).toContainEqual({ v: 1, type: 'output', data: 'hello terminal' });

    // Client input travels back through the same bridge.
    client.emit('message', JSON.stringify({ v: 1, type: 'input', data: 'ls\r' }));
    expect(native.sent).toContain('ls\r');
  });

  it('resizes owned sessions through the service and rejects invalid ownership', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const api = createPluginTerminalApi({ pkg: 'pkg-resize', service: () => service });
    const { id } = await api.create({ projectDir: '/projects/a' });

    api.resize(id, 132, 43);
    expect(() => api.resize(id, 0, 43)).toThrow(/positive/);
    expect(() => api.resize('pty_unknown', 80, 24)).toThrow(/not owned by this package/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.resized).toEqual([{ id, directory: '/projects/a', cols: 132, rows: 43 }]);
  });

  it('kills an owned session and forgets it', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const api = createPluginTerminalApi({ pkg: 'pkg-kill', service: () => service });
    const { id } = await api.create({ projectDir: '/projects/a' });

    api.kill(id);
    api.kill(id); // idempotent
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.removed).toEqual([{ id, directory: '/projects/a' }]);
    await expect(
      api.bridge(id, new FakeClientSocket() as unknown as WebSocket),
    ).rejects.toThrow(/not owned by this package/);

    await api.dispose();
    expect(calls.removed).toEqual([{ id, directory: '/projects/a' }]);
  });

  it('reports a neutral error when the host did not wire a terminal service', async () => {
    const api = createPluginTerminalApi({ pkg: 'pkg-unwired', service: () => undefined });
    await expect(api.create({ projectDir: '/projects/a' })).rejects.toThrow(/ctx\.terminal is not available/);
    await expect(api.bridge('pty_1', new FakeClientSocket() as unknown as WebSocket))
      .rejects.toThrow(/ctx\.terminal is not available/);
  });

  it('propagates the runtime 503 when the active runtime has no PTY channel', async () => {
    const { service } = serviceWith({});
    const api = createPluginTerminalApi({ pkg: 'pkg-unsupported', service: () => service });
    await expect(api.create({ projectDir: '/projects/a' })).rejects.toMatchObject({ status: 503 });
  });
});

/* ------------------------------------------------------- context injection */

describe('package context host services', () => {
  it('exposes files/terminal without leaking the package-scoped projectDir', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const root = mkTmpDir('mafw-ctx-');
    const bag = createRegistrationBag();
    write(root, 'note.md', 'hello');

    try {
      const ctx = createPluginPackageContext('demo', {
        projectDir: '/gateway/launch/dir',
        gatewayPort: 3000,
        bag,
        terminal: () => service,
      });

      expect((await ctx.files.list(root, '.')).map((entry) => entry.name)).toEqual(['note.md']);
      const { id } = await ctx.terminal.create({ projectDir: root });
      expect(calls.created[0].directory).toBe(root);

      // Reload/disable/remove dispose the activation bag -> PTY closed.
      await bag.dispose();
      expect(calls.removed).toEqual([{ id, directory: root }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('turns terminal calls into a neutral error when the host wiring is absent', async () => {
    const ctx = createPluginPackageContext('demo', { projectDir: '/p', gatewayPort: 3000 });
    await expect(ctx.terminal.create({ projectDir: '/p' })).rejects.toThrow(/ctx\.terminal is not available/);
    expect(typeof ctx.files.list).toBe('function');
  });

  it('closes a package PTY when the host retires the committed package', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const dir = mkTmpDir('mafw-host-pty-');
    const projectDir = mkTmpDir('mafw-host-project-');
    (globalThis as any).__mafwPtyProject = projectDir;
    delete (globalThis as any).__mafwPtyCreated;

    fs.writeFileSync(path.join(dir, 'term.js'), `
module.exports = { name: 'term', async activate(ctx) {
  const g = globalThis;
  g.__mafwPtyCreated = await ctx.terminal.create({ projectDir: g.__mafwPtyProject });
  g.__mafwHasFiles = typeof ctx.files.list === 'function';
  return { usage: { name: 'term', type: 'api', async fetch() { return null; } } };
} };
`);

    const host = new PluginHost(
      dir,
      (name, bag) => createPluginPackageContext(name, {
        projectDir: '/gateway/launch/dir',
        gatewayPort: 3000,
        bag,
        terminal: () => service,
      }),
    );

    try {
      await host.init();
      expect((globalThis as any).__mafwHasFiles).toBe(true);
      const created = (globalThis as any).__mafwPtyCreated as { id: string };
      expect(created).toEqual({ id: 'pty_1' });
      expect(calls.created[0].directory).toBe(projectDir);

      await host.removePackage('term');
      expect(calls.removed).toEqual([{ id: created.id, directory: projectDir }]);
    } finally {
      host.stop();
      delete (globalThis as any).__mafwPtyProject;
      delete (globalThis as any).__mafwPtyCreated;
      delete (globalThis as any).__mafwHasFiles;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------- revision replacement */

describe('revision replacement PTY ownership', () => {
  let dir: string;
  let projectDir: string;

  beforeEach(() => {
    dir = mkTmpDir('mafw-replace-pty-');
    projectDir = mkTmpDir('mafw-replace-project-');
    (globalThis as any).__mafwPtyProject = projectDir;
    (globalThis as any).__mafwPtyIds = [];
  });

  afterEach(() => {
    delete (globalThis as any).__mafwPtyProject;
    delete (globalThis as any).__mafwPtyIds;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function hostFor(service: TerminalService, options: PluginHostOptions = {}): PluginHost {
    return new PluginHost(
      dir,
      (name, bag) => createPluginPackageContext(name, {
        projectDir: '/gateway/launch/dir',
        gatewayPort: 3000,
        bag,
        terminal: () => service,
      }),
      options,
    );
  }

  /**
   * Regression (Task 5 review, Important): a re-activating reload activates the
   * successor *before* the replaced revision's bag is disposed. A package-wide
   * sweep keyed by package name would therefore close the successor's PTYs
   * inside the old revision's disposer. Cleanup must stay instance/bag-scoped.
   */
  it('reload: the replaced revision closes only its own PTY, the successor keeps its own', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    writePtyPackage(dir, 'v1');
    const host = hostFor(service);

    try {
      await host.init();
      expect((globalThis as any).__mafwPtyIds).toEqual(['pty_1']);

      writePtyPackage(dir, 'v2');
      await host.reload();

      expect((globalThis as any).__mafwPtyIds).toEqual(['pty_1', 'pty_2']);
      // Only the replaced revision's session is closed.
      expect(calls.removed).toEqual([{ id: 'pty_1', directory: projectDir }]);
      // The committed successor still owns its PTY: resize would throw
      // "not owned by this package" if the old bag had swept it.
      await expect(host.invokeAction('term', 'resize', {})).resolves.toEqual({ id: 'pty_2' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls.resized).toEqual([{ id: 'pty_2', directory: projectDir, cols: 80, rows: 24 }]);
    } finally {
      host.stop();
    }
  });

  /**
   * Same ordering through `runApplyPending` (active-runtime package): the
   * replaced bag is disposed at apply time, after the pending candidate has
   * already activated and created its PTY.
   */
  it('applyPending: the replaced revision closes only its own PTY, the successor keeps its own', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    writePtyPackage(dir, 'v1', true);
    const host = hostFor(service, { activeRuntime: () => 'term' });

    try {
      await host.init();
      expect((globalThis as any).__mafwPtyIds).toEqual(['pty_1']);

      writePtyPackage(dir, 'v2', true);
      await host.reload();

      // Pending activation created its PTY while the old revision still serves.
      expect((globalThis as any).__mafwPtyIds).toEqual(['pty_1', 'pty_2']);
      expect(host.getPending('term')).not.toBeNull();
      expect(calls.removed).toEqual([]);

      const applied = await host.applyPending('term');
      expect(applied.applied).toBe(true);
      expect(calls.removed).toEqual([{ id: 'pty_1', directory: projectDir }]);

      await expect(host.invokeAction('term', 'resize', {})).resolves.toEqual({ id: 'pty_2' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls.resized).toEqual([{ id: 'pty_2', directory: projectDir, cols: 80, rows: 24 }]);
    } finally {
      host.stop();
    }
  });
});

/* ------------------------------------------------------------ composition */

describe('gateway composition root', () => {
  /**
   * `kernel.ts` (the composition root; D3 Task 8 moved it out of `index.ts`)
   * cannot be instantiated in a unit test (it boots the gateway), so
   * the injection point is pinned at the source level — the same pattern the
   * repo uses for other composition-root wiring. Without this line the whole
   * `ctx.terminal` feature would be dead in production while every unit test
   * still passes (they inject the service themselves).
   */
  it('injects the shared TerminalService into the package context', () => {
    const source = [
      fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf8'),
      fs.readFileSync(path.join(__dirname, '../../../src/boot.ts'), 'utf8'),
    ].join('\n');
    expect(source).toContain('terminal: () => kernel.getTerminalService(),');
  });
});
