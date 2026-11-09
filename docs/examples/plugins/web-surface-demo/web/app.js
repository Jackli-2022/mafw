/**
 * web-surface-demo page half.
 *
 * Runs inside the sandboxed plugin `<webview>` (no Node, no host DOM access).
 * It talks to the gateway only through its own namespace:
 *
 *   GET  /api/plugins/web-surface-demo/api/files   (ctx.http → ctx.files)
 *   WS   /api/plugins/web-surface-demo/ws/term     (ctx.http.ws → ctx.terminal)
 *
 * When Desktop injects the bridge, the page additionally reads its context and
 * theme, subscribes to `plugin:web-surface-demo:changed`, and can invoke the
 * package action that emits it. The page always runs inside the host
 * `<webview>`: `api/*`, `ws/*` and `events` require the ticket cookie main
 * installs (loopback alone is not authorization), so a plain browser tab has no
 * project context. Bridge-only buttons hide themselves when `window.mafwPlugin`
 * is missing.
 */
(function () {
  'use strict';

  var PACKAGE = 'web-surface-demo';
  var CHANGED_EVENT = 'plugin:web-surface-demo:changed';
  var FILES_URL = '/api/plugins/' + PACKAGE + '/api/files';
  var TERM_URL =
    (location.protocol === 'https:' ? 'wss://' : 'ws://') +
    location.host +
    '/api/plugins/' +
    PACKAGE +
    '/ws/term';

  var filesEl = document.getElementById('files');
  var contextEl = document.getElementById('context');
  var refreshEl = document.getElementById('refresh');
  var notifyEl = document.getElementById('notify');
  var statusEl = document.getElementById('status');
  var terminalEl = document.getElementById('terminal');
  var inputEl = document.getElementById('term-input');

  var bridge =
    window.mafwPlugin && window.mafwPlugin.version === 1 ? window.mafwPlugin : null;
  var socket = null;

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', isError === true);
  }

  function formatBytes(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderEntries(payload) {
    filesEl.textContent = '';
    var entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (entries.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'meta';
      empty.textContent = 'No visible files in this project.';
      filesEl.appendChild(empty);
      return;
    }
    entries.forEach(function (entry) {
      var row = document.createElement('li');
      if (entry.kind === 'dir') row.className = 'dir';

      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = (entry.kind === 'dir' ? '▸ ' : '  ') + entry.name;

      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = entry.kind === 'dir' ? 'dir' : formatBytes(entry.size);

      row.appendChild(name);
      row.appendChild(meta);
      filesEl.appendChild(row);
    });
  }

  async function loadFiles(reason) {
    refreshEl.disabled = true;
    try {
      var response = await fetch(FILES_URL, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      var body = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status);
      renderEntries(body);
      publishBadge(body.entries.length);
      setStatus(
        'Listed ' + body.entries.length + ' entries from ' + body.projectDir +
          (reason ? ' (' + reason + ')' : '')
      );
    } catch (err) {
      publishBadge(0);
      setStatus('Cannot read project files: ' + (err && err.message ? err.message : err), true);
    } finally {
      refreshEl.disabled = false;
    }
  }

  // ------------------------------------------------------------------ bridge

  /** `rail.badge: true` needs a producer: the count mirrors the file list. */
  function publishBadge(count) {
    if (!bridge || typeof bridge.setBadge !== 'function') return;
    try {
      bridge.setBadge(count);
    } catch (err) {
      /* the badge is cosmetic; never break the page over it */
    }
  }

  function describeContext(ctx) {
    if (!ctx) return 'context: unavailable';
    var parts = [String(ctx.projectDir || 'unknown project')];
    if (ctx.sessionID) parts.push(String(ctx.sessionID));
    if (ctx.surface) parts.push(String(ctx.surface));
    return 'context: ' + parts.join(' · ');
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.dataset.theme = theme;
    }
  }

  if (bridge) {
    notifyEl.disabled = false;
    Promise.resolve(bridge.context())
      .then(function (ctx) {
        contextEl.textContent = describeContext(ctx);
        applyTheme(ctx && ctx.theme);
      })
      .catch(function () {
        contextEl.textContent = 'context: unavailable';
      });
    bridge.onThemeChange(function (theme) {
      applyTheme(theme);
    });
    bridge.onContextChange(function (ctx) {
      contextEl.textContent = describeContext(ctx);
    });
    bridge.onEvent(CHANGED_EVENT, function (payload) {
      var source = payload && payload.source ? String(payload.source) : 'event';
      loadFiles('event from ' + source);
    });
  } else {
    contextEl.textContent = 'context: loopback (no bridge)';
    notifyEl.title = 'Bridge actions are only available inside Desktop.';
  }

  refreshEl.addEventListener('click', function () {
    loadFiles('manual');
  });

  notifyEl.addEventListener('click', function () {
    if (!bridge) return;
    notifyEl.disabled = true;
    Promise.resolve(bridge.invoke('emitChanged', { source: 'page' }))
      .then(function (result) {
        setStatus('emitChanged → ' + JSON.stringify(result));
      })
      .catch(function (err) {
        setStatus('emitChanged failed: ' + (err && err.message ? err.message : err), true);
      })
      .finally(function () {
        notifyEl.disabled = false;
      });
  });

  // ---------------------------------------------------------------- terminal

  function appendTerminal(text) {
    terminalEl.textContent += text;
    terminalEl.scrollTop = terminalEl.scrollHeight;
  }

  function sendFrame(frame) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  }

  function sendResize() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    var cols = Math.max(20, Math.floor(terminalEl.clientWidth / 7));
    var rows = Math.max(6, Math.floor(terminalEl.clientHeight / 18));
    sendFrame({ v: 1, type: 'resize', cols: cols, rows: rows });
  }

  function connectTerminal() {
    if (typeof WebSocket !== 'function') {
      appendTerminal('[terminal not available in this environment]\n');
      return;
    }
    socket = new WebSocket(TERM_URL);

    socket.addEventListener('open', function () {
      inputEl.disabled = false;
      inputEl.focus();
      appendTerminal('[connected]\n');
      sendResize();
    });

    socket.addEventListener('message', function (event) {
      var frame;
      try {
        frame = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (frame.type === 'output') appendTerminal(frame.data);
      else if (frame.type === 'error') appendTerminal('\n[terminal unavailable] ' + frame.message + '\n');
      else if (frame.type === 'meta' && frame.event) appendTerminal('\n[' + frame.event + ']\n');
      else if (frame.type === 'close') {
        appendTerminal('\n[terminal closed: ' + (frame.reason || 'done') + ']\n');
      }
    });

    socket.addEventListener('close', function () {
      inputEl.disabled = true;
      appendTerminal('\n[terminal disconnected]\n');
    });

    socket.addEventListener('error', function () {
      appendTerminal('\n[terminal connection failed]\n');
    });
  }

  inputEl.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      var line = inputEl.value;
      inputEl.value = '';
      sendFrame({ v: 1, type: 'input', data: line + '\n' });
      return;
    }
    if (event.key === 'c' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      inputEl.value = '';
      sendFrame({ v: 1, type: 'input', data: '\u0003' });
    }
  });

  window.addEventListener('resize', sendResize);

  loadFiles('initial');
  connectTerminal();
})();
