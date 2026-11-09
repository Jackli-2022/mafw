/**
 * Standalone checks for the web-surface-demo reference package.
 *
 * Runs with `node --test docs/examples/plugins/web-surface-demo/index.test.js`.
 * No gateway, no dependencies: the package is activated with a fake context
 * that records `ctx.http` registrations and the `ctx.files` / `ctx.terminal`
 * calls, so every route handler and action is exercised directly.
 *
 * What this proves and what it does not:
 *   - proves the package declares one Web surface, registers exactly two
 *     routes, and reads the *caller's* project directory (never ctx.projectDir);
 *   - does not prove the gateway serves these routes, that the ticket is bound
 *     to a project, or that the desktop sandbox loads the page. Those live in
 *     `gateway/tests/integration/plugin-web-surface.test.ts`.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const plugin = require("./index.js");

const PACKAGE = "web-surface-demo";
const CHANGED_EVENT = "plugin:web-surface-demo:changed";
const CALL = { signal: new AbortController().signal };

const DEFAULT_ENTRIES = [
  { name: "src", kind: "dir", size: 0, mtime: 1 },
  { name: "README.md", kind: "file", size: 12, mtime: 2 },
];

function fakeSocket() {
  const handlers = new Map();
  const sent = [];
  const closed = [];
  return {
    sent,
    closed,
    send(data) {
      sent.push(JSON.parse(data));
    },
    close(code, reason) {
      closed.push({ code, reason });
    },
    on(event, callback) {
      const list = handlers.get(event) ?? [];
      list.push(callback);
      handlers.set(event, list);
    },
    emit(event, ...args) {
      for (const callback of handlers.get(event) ?? []) callback(...args);
    },
  };
}

function createContext(options = {}) {
  const filesCalls = [];
  const emitted = [];
  const httpRoutes = [];
  const terminal = { create: [], bridge: [], resize: [], kill: [] };
  const ctx = {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    fetch: async () => {
      throw new Error("the example never performs network requests");
    },
    apiKey: () => null,
    pluginConfig: () => ({}),
    config: { update() {} },
    projectDir: options.projectDir ?? "/gateway/launch/directory",
    gatewayPort: 3000,
    usage: { modelStats: () => [] },
    emit(event) {
      emitted.push(event);
    },
    effect() {},
    http: {
      route(method, routePath, handler, opts) {
        httpRoutes.push({ kind: "http", method, path: routePath, handler, opts });
      },
      ws(routePath, handler) {
        httpRoutes.push({ kind: "ws", path: routePath, handler });
      },
    },
    files: {
      async list(dir, rel) {
        filesCalls.push({ dir, rel });
        if (options.filesError) throw options.filesError;
        // Unknown fields must never reach the page payload.
        return (options.entries ?? DEFAULT_ENTRIES).map((entry) => ({
          ...entry,
          internal: "should-not-leak",
        }));
      },
    },
    terminal: {
      async create(opts) {
        terminal.create.push(opts);
        if (options.terminalError) throw options.terminalError;
        return { id: "pty_1" };
      },
      async bridge(id, ws) {
        terminal.bridge.push({ id, ws });
      },
      resize(id, cols, rows) {
        terminal.resize.push({ id, cols, rows });
      },
      kill(id) {
        terminal.kill.push(id);
      },
    },
  };
  return { ctx, emitted, httpRoutes, filesCalls, terminal };
}

async function activate(options) {
  const harness = createContext(options);
  const contributions = await plugin.activate(harness.ctx);
  return { ...harness, contributions };
}

function httpRoute(harness, method, routePath) {
  return harness.httpRoutes.find(
    (entry) => entry.kind === "http" && entry.method === method && entry.path === routePath,
  );
}

function wsRoute(harness, routePath) {
  return harness.httpRoutes.find((entry) => entry.kind === "ws" && entry.path === routePath);
}

test("exposes a dependency-free unified package identity", () => {
  assert.equal(plugin.name, PACKAGE);
  assert.equal(typeof plugin.activate, "function");
  const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.doesNotMatch(source, /\brequire\s*\(/, "the example must not require any module");
});

test("declares one sandboxed Web surface with a left-rail entry", async () => {
  const { contributions } = await activate();
  assert.equal(contributions.ui.panels, undefined);
  assert.equal(contributions.ui.webSurfaces.length, 1);

  const surface = contributions.ui.webSurfaces[0];
  assert.equal(surface.id, "explorer");
  assert.equal(surface.title, "Web Surface Demo");
  assert.equal(surface.entry, "index.html");
  assert.equal(surface.scope, "project");
  assert.equal(surface.icon, "folder");
  assert.deepEqual(surface.rail, { icon: "folder", order: 10, badge: true });
  // The entry is a relative path below the package's web/ directory.
  assert.doesNotMatch(surface.entry, /(^[/\\])|(^\.\.)|(\.\.\/)/);
});

test("declares the action, the event and the refresh contract together", async () => {
  const { contributions } = await activate();
  assert.deepEqual(Object.keys(contributions.actions).sort(), ["emitChanged", "listFiles"]);
  assert.equal(contributions.events.length, 1);
  assert.equal(contributions.events[0].type, CHANGED_EVENT);
  assert.deepEqual(contributions.events[0].schema.required.sort(), ["at", "refreshes", "source"]);
  for (const action of Object.values(contributions.actions)) {
    assert.equal(typeof action.handler, "function");
    assert.equal(typeof action.inputSchema, "object");
  }
});

test("registers exactly GET /files and ws /term under the package namespace", async () => {
  const { httpRoutes } = await activate();
  assert.deepEqual(
    httpRoutes.map((entry) => `${entry.kind}:${entry.method ?? "WS"}:${entry.path}`).sort(),
    ["http:GET:/files", "ws:WS:/term"],
  );
});

test("GET /files lists the ticket-bound project, never ctx.projectDir", async () => {
  const harness = await activate();
  const handler = httpRoute(harness, "GET", "/files").handler;

  const response = await handler({ projectDir: "/project/alpha", method: "GET", path: "/files" });
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(response.headers["cache-control"], "no-store");

  const body = JSON.parse(response.body);
  assert.equal(body.projectDir, "/project/alpha");
  assert.deepEqual(body.entries.map((entry) => entry.name), ["src", "README.md"]);
  assert.equal(body.entries[0].kind, "dir");

  assert.deepEqual(harness.filesCalls, [{ dir: "/project/alpha", rel: "." }]);
  // ctx.projectDir is the gateway's launch directory and must never be used.
  assert.notEqual(harness.ctx.projectDir, "/project/alpha");
});

test("GET /files answers 400 with a neutral error when the ticket has no project", async () => {
  const harness = await activate();
  const handler = httpRoute(harness, "GET", "/files").handler;

  const response = await handler({ method: "GET", path: "/files" });
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /projectDir/);
  assert.deepEqual(harness.filesCalls, []);
});

test("GET /files maps entries to public fields and reports file errors", async () => {
  const harness = await activate();
  const handler = httpRoute(harness, "GET", "/files").handler;
  const body = JSON.parse((await handler({ projectDir: "/project/alpha" })).body);
  assert.deepEqual(body.entries[0], { name: "src", kind: "dir", size: 0, mtime: 1 });
  assert.equal(body.entries[0].internal, undefined);

  const failing = await activate({ filesError: new Error("not a directory: .") });
  const failed = await httpRoute(failing, "GET", "/files").handler({ projectDir: "/project" });
  assert.equal(failed.status, 400);
  assert.match(JSON.parse(failed.body).error, /not a directory/);
});

test("listFiles action shares the host-service path and needs an explicit projectDir", async () => {
  const harness = await activate();
  const result = await harness.contributions.actions.listFiles.handler(
    { projectDir: "/project/beta" },
    CALL,
  );
  assert.equal(result.projectDir, "/project/beta");
  assert.deepEqual(harness.filesCalls, [{ dir: "/project/beta", rel: "." }]);
  await assert.rejects(
    () => harness.contributions.actions.listFiles.handler({}, CALL),
    /projectDir/,
  );
});

test("emitChanged emits the registered package event with a revision-local count", async () => {
  const harness = await activate();
  const action = harness.contributions.actions.emitChanged;

  assert.deepEqual(await action.handler({}, CALL), { emitted: true, refreshes: 1 });
  assert.deepEqual(await action.handler({ source: "page" }, CALL), { emitted: true, refreshes: 2 });

  assert.equal(harness.emitted.length, 2);
  assert.equal(harness.emitted[1].type, CHANGED_EVENT);
  assert.deepEqual(Object.keys(harness.emitted[1].properties).sort(), ["at", "refreshes", "source"]);
  assert.equal(harness.emitted[1].properties.source, "page");
  assert.equal(harness.emitted[1].properties.refreshes, 2);
  assert.ok(!Number.isNaN(Date.parse(harness.emitted[1].properties.at)));
});

test("ws /term creates and bridges a PTY for the ticket project, then kills it on close", async () => {
  const harness = await activate();
  const socket = fakeSocket();
  const handler = wsRoute(harness, "/term").handler;
  assert.equal(typeof handler, "function");

  await handler(socket, { projectDir: "/project/alpha", sessionID: "ses_1" });
  assert.deepEqual(harness.terminal.create, [
    { projectDir: "/project/alpha", cols: 100, rows: 24 },
  ]);
  assert.deepEqual(harness.terminal.bridge.map((entry) => entry.id), ["pty_1"]);

  socket.emit("close");
  assert.deepEqual(harness.terminal.kill, ["pty_1"]);
});

test("ws /term reports a neutral error when the host has no PTY", async () => {
  const harness = await activate({
    terminalError: new Error("terminal PTY is not supported by the active runtime"),
  });
  const socket = fakeSocket();

  await wsRoute(harness, "/term").handler(socket, { projectDir: "/project/alpha" });

  assert.equal(harness.terminal.bridge.length, 0);
  assert.equal(socket.sent[0].type, "error");
  assert.match(socket.sent[0].message, /not supported/);
  assert.deepEqual(socket.closed, [{ code: 1011, reason: "terminal unavailable" }]);
});

test("the page is CSP-safe and only calls its own package namespace", () => {
  const html = fs.readFileSync(path.join(__dirname, "web", "index.html"), "utf8");
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /\bsrc=["']app\.js["']/, "the only script tag must be external");
  assert.doesNotMatch(html, /\son[a-z]+=["']/i, "no inline event handlers");
  for (const id of ["files", "terminal", "term-input", "refresh", "notify"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  const app = fs.readFileSync(path.join(__dirname, "web", "app.js"), "utf8");
  assert.ok(app.includes(`/api/plugins/${PACKAGE}/api/files`));
  assert.ok(app.includes(`/api/plugins/${PACKAGE}/ws/term`));
  assert.ok(app.includes("window.mafwPlugin"), "bridge is optional, not required");
  assert.ok(app.includes(CHANGED_EVENT), "subscribes to its own registered event");
  assert.ok(app.includes("emitChanged"), "invokes its own action through the bridge");
  assert.doesNotMatch(app, /\brequire\s*\(/, "the page has no module loader");
  assert.doesNotMatch(app, /\bprocess\./, "the page has no Node globals");
});
