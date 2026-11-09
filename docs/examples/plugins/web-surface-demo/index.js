/**
 * web-surface-demo — reference MAFW package for sandboxed Web surfaces.
 *
 * A Web surface is a real page (`web/index.html`, `web/app.js`) that Desktop
 * loads inside a sandboxed `<webview>` in the workbench. The page talks to the
 * gateway through two channels the plugin owns:
 *
 *   - `ctx.http`   → `/api/plugins/web-surface-demo/api/files` (project file tree)
 *                  → `/api/plugins/web-surface-demo/ws/term`   (PTY bridge)
 *   - bridge       → `window.mafwPlugin` for context/theme, `invoke`, `onEvent`
 *
 * Filesystem and terminal access are *host services*: the package calls
 * `ctx.files.*` with an explicit project directory and `ctx.terminal.*`; the
 * page never gets direct file/PTY access, only what these routes expose.
 *
 * The project directory always comes from the caller — `req.projectDir` for an
 * HTTP/WS route (resolved from the Web-surface ticket) or an explicit
 * `projectDir` action input. It is never `ctx.projectDir`, which is the
 * gateway's launch directory.
 *
 * Copy this directory to a scratch location, install it from
 * Plugins → 安装本地目录, and read docs/guides/plugin-authoring.md §6.5.
 */
'use strict';

const PACKAGE_NAME = 'web-surface-demo';
const CHANGED_EVENT = 'plugin:web-surface-demo:changed';
const SURFACE_ID = 'explorer';

const FILE_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: ['file', 'dir'] },
    size: { type: 'integer', minimum: 0 },
    mtime: { type: 'integer', minimum: 0 },
  },
  required: ['name', 'kind'],
  additionalProperties: false,
};

const FILE_LIST_SCHEMA = {
  type: 'object',
  properties: {
    projectDir: { type: 'string' },
    entries: { type: 'array', items: FILE_ENTRY_SCHEMA },
  },
  required: ['projectDir', 'entries'],
  additionalProperties: false,
};

function messageOf(err) {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** `ws` and the browser WebSocket both use readyState 1 for OPEN. */
const WS_OPEN = 1;

/**
 * True once the socket left the OPEN state (closing/closed). The host may
 * finish creating the PTY after the page navigated away; a close listener
 * attached that late would never fire, so the caller must reap the PTY now.
 */
function socketClosed(socket) {
  return typeof socket.readyState === 'number' && socket.readyState !== WS_OPEN;
}

function requireProjectDir(value, source) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${source} needs an explicit projectDir (never ctx.projectDir)`);
  }
  return value;
}

/** Keeps only the portable fields of a `ctx.files.list` entry. */
function publicEntry(entry) {
  const out = { name: entry.name, kind: entry.kind };
  if (typeof entry.size === 'number') out.size = entry.size;
  if (typeof entry.mtime === 'number') out.mtime = entry.mtime;
  return out;
}

module.exports = {
  name: PACKAGE_NAME,
  async activate(ctx) {
    let refreshes = 0;

    /** `ctx.files` is read-only and rooted at the given project directory. */
    const listEntries = async (projectDir, source) => {
      const root = requireProjectDir(projectDir, source);
      const entries = await ctx.files.list(root, '.');
      return { projectDir: root, entries: entries.map(publicEntry) };
    };

    const emitChanged = (source) => {
      refreshes += 1;
      ctx.emit({
        type: CHANGED_EVENT,
        properties: { source, refreshes, at: new Date().toISOString() },
      });
    };

    const json = (status, payload) => ({
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify(payload),
    });

    // Served at `/api/plugins/web-surface-demo/api/files`.
    // The page calls its own namespace; no gateway route is reachable from here.
    ctx.http.route('GET', '/files', async (req) => {
      let projectDir;
      try {
        projectDir = requireProjectDir(req.projectDir, 'GET /files');
      } catch (err) {
        // No ticket project: the caller asked without a usable context.
        return json(400, { error: messageOf(err) });
      }
      try {
        return json(200, await listEntries(projectDir, 'GET /files'));
      } catch (err) {
        // Host failure (permissions, transient FS): a server error. The raw
        // message can carry absolute paths, so the page gets neutral copy.
        ctx.log.warn(`[${PACKAGE_NAME}] GET /files failed: ${messageOf(err)}`);
        return json(500, { error: 'project files are unavailable' });
      }
    });

    // Served at `/api/plugins/web-surface-demo/ws/term`.
    // The host owns the PTY: create it for the ticket's project, then let the
    // host bridge MAFW terminal frames between this socket and the runtime.
    ctx.http.ws('/term', async (socket, reqCtx) => {
      let session;
      try {
        session = await ctx.terminal.create({ projectDir: reqCtx.projectDir, cols: 100, rows: 24 });
      } catch (err) {
        try { socket.send(JSON.stringify({ type: 'error', message: messageOf(err) })); } catch { /* closed */ }
        try { socket.close(1011, 'terminal unavailable'); } catch { /* closed */ }
        return;
      }
      const id = session.id;
      // The socket can close while the host is still creating the PTY. Attach
      // the listener only while it can still fire; otherwise reap right away.
      if (socketClosed(socket)) {
        ctx.terminal.kill(id);
        return;
      }
      socket.on('close', () => ctx.terminal.kill(id));
      try {
        await ctx.terminal.bridge(id, socket);
      } catch (err) {
        ctx.terminal.kill(id);
        try { socket.close(1011, 'terminal bridge failed'); } catch { /* closed */ }
        ctx.log.warn(`[${PACKAGE_NAME}] terminal bridge failed: ${messageOf(err)}`);
      }
    });

    return {
      ui: {
        webSurfaces: [
          {
            id: SURFACE_ID,
            title: 'Web Surface Demo',
            icon: 'folder',
            // Default entry. The file must exist under `web/` or activation
            // fails (fail-closed; no 404 page is ever published).
            entry: 'index.html',
            // Project scope: the page is bound to the project, not one session.
            scope: 'project',
            rail: { icon: 'folder', order: 10, badge: true },
          },
        ],
      },
      events: [
        {
          type: CHANGED_EVENT,
          title: 'Web surface refreshed',
          description:
            'Emitted by the emitChanged action (bridge or REST) so the page re-fetches /api/files.',
          scope: 'global',
          schema: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              refreshes: { type: 'integer', minimum: 1 },
              at: { type: 'string' },
            },
            required: ['source', 'refreshes', 'at'],
            additionalProperties: false,
          },
        },
      ],
      actions: {
        // Bridge-callable equivalent of GET /files. The page usually uses the
        // HTTP route (it works without the bridge too); this action exists to
        // show that both channels share one host-service helper.
        listFiles: {
          title: 'List project files',
          description: 'Reads the project root through ctx.files (read-only).',
          inputSchema: {
            type: 'object',
            properties: { projectDir: { type: 'string' } },
            required: ['projectDir'],
            additionalProperties: false,
          },
          outputSchema: FILE_LIST_SCHEMA,
          handler(input) {
            return listEntries(input && input.projectDir, 'listFiles');
          },
        },
        emitChanged: {
          title: 'Notify the page',
          description: 'Emits plugin:web-surface-demo:changed so the page re-fetches its files.',
          inputSchema: {
            type: 'object',
            properties: { source: { type: 'string' } },
            additionalProperties: false,
          },
          outputSchema: {
            type: 'object',
            properties: { emitted: { type: 'boolean' }, refreshes: { type: 'integer' } },
            required: ['emitted', 'refreshes'],
            additionalProperties: false,
          },
          handler(input) {
            const source =
              input && typeof input.source === 'string' && input.source.length > 0
                ? input.source
                : 'action';
            emitChanged(source);
            return { emitted: true, refreshes };
          },
        },
      },
    };
  },
};
