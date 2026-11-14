/**
 * Untrusted package worker bootstrap (CommonJS on purpose: it runs in both
 * Jest and the compiled gateway without a TypeScript loader in the child).
 *
 * Defense-in-depth, not a hermetic sandbox: Node's permission model owns fs /
 * child-process / addon access; this file removes network and module escape
 * hatches from the JS surface so accidental/malicious package code cannot
 * quietly open sockets. The host still treats worker output as untrusted data.
 */
'use strict';

const Module = require('module');

const FORBIDDEN_MODULES = new Set([
  'http', 'https', 'net', 'tls', 'dns', 'dgram', 'http2',
  'child_process', 'worker_threads', 'cluster',
]);
const originalLoad = Module._load;
Module._load = function guardedLoad(request, parent, isMain) {
  const name = String(request || '').replace(/^node:/, '');
  if (FORBIDDEN_MODULES.has(name)) {
    throw new Error(`not available in untrusted worker: ${name}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};

globalThis.fetch = () => {
  throw new Error('not available in untrusted worker: fetch');
};
globalThis.WebSocket = class {
  constructor() {
    throw new Error('not available in untrusted worker: WebSocket');
  }
};
globalThis.EventSource = class {
  constructor() {
    throw new Error('not available in untrusted worker: EventSource');
  }
};

const entry = process.argv[2];
if (!entry) {
  process.stderr.write('worker bootstrap: missing package entry\n');
  process.exit(2);
}

const pendingConfig = new Map();
const effects = [];
let handlers = new Map();
let configSeq = 0;

const MAX_MESSAGE_BYTES = 1024 * 1024;

function send(message) {
  if (typeof process.send === 'function') process.send(message);
}

function sendResult(id, ok, payload) {
  const message = ok
    ? { t: 'result', id, ok: true, output: payload }
    : { t: 'result', id, ok: false, error: { message: String(payload) } };
  if (Buffer.byteLength(JSON.stringify(message), 'utf8') > MAX_MESSAGE_BYTES) {
    send({ t: 'result', id, ok: false, error: { message: 'message_too_large' } });
    return;
  }
  send(message);
}

function log(level, message) {
  send({ t: 'log', level, message: String(message) });
}

function makeLogger() {
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (...args) => log(level, args.map(String).join(' '));
  }
  return logger;
}

function requestConfig(method, payload) {
  const id = `cfg_${++configSeq}`;
  return new Promise((resolve, reject) => {
    pendingConfig.set(id, { resolve, reject });
    send({ t: method, id, ...(payload !== undefined ? { patch: payload } : {}) });
  });
}

function normalizeContributions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { actions: {}, events: {} };
  const allowed = new Set(['actions', 'events']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key) && raw[key] !== undefined) {
      throw new Error(`not allowed in untrusted worker: ${key}`);
    }
  }
  const actions = {};
  const source = raw.actions && typeof raw.actions === 'object' ? raw.actions : {};
  for (const [name, declaration] of Object.entries(source)) {
    if (!declaration || typeof declaration !== 'object') continue;
    const { handler, ...meta } = declaration;
    if (typeof handler === 'function') handlers.set(name, handler);
    actions[name] = { ...meta, workerAction: name };
  }
  const events = {};
  const sourceEvents = raw.events && typeof raw.events === 'object' ? raw.events : {};
  for (const [key, declaration] of Object.entries(sourceEvents)) {
    if (!declaration || typeof declaration !== 'object') continue;
    const { handler, ...meta } = declaration;
    events[key] = meta;
  }
  return { actions, events };
}

async function start() {
  const mod = require(entry);
  if (!mod || typeof mod.activate !== 'function') {
    throw new Error('untrusted package must export activate(ctx)');
  }
  const ctx = {
    name: typeof mod.name === 'string' ? mod.name : '',
    version: '',
    log: makeLogger(),
    config: {
      get: () => requestConfig('config.get'),
      update: (patch) => {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          throw new TypeError('config.update requires a plain object');
        }
        return requestConfig('config.update', patch);
      },
    },
    emit: (type, payload) => {
      if (typeof type !== 'string' || !type.startsWith('plugin:')) {
        throw new Error('untrusted worker events must use plugin:<package>:<event>');
      }
      send({ t: 'emit', type, payload });
    },
    effect: (dispose) => {
      if (typeof dispose === 'function') effects.push(dispose);
    },
  };
  const contributions = normalizeContributions(await mod.activate(ctx));
  send({
    t: 'ready',
    name: ctx.name || require(entry).name || '',
    apiVersion: 2,
    contributions,
  });
}

function shutdown() {
  for (const dispose of effects.reverse()) {
    try { dispose(); } catch { /* best effort */ }
  }
  process.exit(0);
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.t === 'result' && pendingConfig.has(message.id)) {
    const pending = pendingConfig.get(message.id);
    pendingConfig.delete(message.id);
    if (message.ok) pending.resolve(message.output);
    else pending.reject(new Error(message.error && message.error.message || 'config request failed'));
    return;
  }
  if (message.t === 'shutdown') {
    shutdown();
    return;
  }
  if (message.t !== 'invoke') return;
  const handler = handlers.get(message.action);
  if (!handler) {
    sendResult(message.id, false, `unknown worker action: ${message.action}`);
    return;
  }
  Promise.resolve()
    .then(() => handler(message.input, { signal: new AbortController().signal }))
    .then(
      (output) => sendResult(message.id, true, output),
      (err) => sendResult(message.id, false, err && err.message ? err.message : String(err)),
    );
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`uncaughtException: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  process.stderr.write(`unhandledRejection: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

start().catch((err) => {
  process.stderr.write(`worker activate failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
