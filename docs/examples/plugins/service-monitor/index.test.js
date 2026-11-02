/**
 * Standalone checks for the service-monitor reference package.
 *
 * Runs with `node --test docs/examples/plugins/service-monitor/index.test.js`.
 * No gateway, no dependencies: the package is activated with a fake context and
 * every declared slot/action/event is exercised against the public contract
 * vocabulary (plain JSON only, no functions or executable widgets).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("./index.js");

const CHANGED_EVENT = "plugin:service-monitor:changed";

function createContext(initialConfig = {}) {
  let config = { ...initialConfig };
  const emitted = [];
  const persisted = [];
  const ctx = {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    fetch: async () => {
      throw new Error("the example never performs network requests");
    },
    apiKey: () => null,
    pluginConfig: () => ({ ...config }),
    config: {
      update(patch) {
        config = { ...config, ...patch };
        persisted.push({ plugins: { "service-monitor": { config: { ...config } } } });
      },
    },
    projectDir: process.cwd(),
    gatewayPort: 3000,
    usage: { modelStats: () => [] },
    emit(event) {
      emitted.push(event);
    },
  };
  return { ctx, emitted, persisted, readConfig: () => ({ ...config }) };
}

async function activate(initialConfig) {
  const harness = createContext(initialConfig);
  const contributions = await plugin.activate(harness.ctx);
  return { ...harness, contributions };
}

function collectWidgets(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectWidgets(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (typeof value.type === "string") out.push(value);
  for (const child of Object.values(value)) collectWidgets(child, out);
  return out;
}

function assertJsonWidgets(widgets) {
  assert.ok(Array.isArray(widgets), "view body must be an array");
  const visit = (value, depth) => {
    assert.ok(depth <= 12, "widget nesting is too deep");
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(typeof child, "function", `widget field ${key} must not be a function`);
      visit(child, depth + 1);
    }
  };
  visit(widgets, 0);
}

test("exposes a dependency-free unified package identity", () => {
  assert.equal(plugin.name, "service-monitor");
  assert.equal(typeof plugin.activate, "function");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "index.js"), "utf8");
  assert.doesNotMatch(source, /\brequire\s*\(/, "the example must not require any module");
});

test("declares all four UI slots, two required actions and one package event", async () => {
  const { contributions } = await activate();
  const { ui, actions, events } = contributions;
  assert.ok(ui);
  assert.equal(ui.panels.length, 1);
  assert.equal(ui.configPages.length, 1);
  assert.equal(ui.toolCards.length, 1);
  assert.equal(ui.messageWindows.length, 1);
  assert.equal(typeof actions.refresh.handler, "function");
  assert.equal(typeof actions.saveConfig.handler, "function");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, CHANGED_EVENT);
});

test("every slot reference resolves inside the package", async () => {
  const { contributions } = await activate();
  const actionNames = new Set(Object.keys(contributions.actions));
  const eventTypes = new Set(contributions.events.map((event) => event.type));
  const ui = contributions.ui;

  for (const panel of ui.panels) {
    assert.ok(actionNames.has(panel.viewAction));
    for (const type of panel.refreshOn ?? []) assert.ok(eventTypes.has(type));
  }
  for (const page of ui.configPages) {
    assert.ok(actionNames.has(page.loadAction));
    assert.ok(actionNames.has(page.saveAction));
  }
  for (const card of ui.toolCards) {
    assert.ok(actionNames.has(card.viewAction));
    assert.ok(card.tools.length > 0);
  }
  for (const window of ui.messageWindows) {
    assert.ok(actionNames.has(window.viewAction));
    assert.ok(eventTypes.has(window.triggerEvent));
  }
});

test("the config schema is the restricted form subset", async () => {
  const { contributions } = await activate();
  const schema = contributions.ui.configPages[0].schema;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["endpoint", "intervalSeconds", "verbose"]);
  const kinds = Object.values(schema.properties).map((field) => field.type);
  for (const kind of kinds) assert.ok(["string", "number", "integer", "boolean"].includes(kind));
  for (const field of Object.values(schema.properties)) {
    assert.equal(typeof field, "object");
    assert.equal(field.properties, undefined, "nested objects are not supported");
  }
});

test("refresh returns a view and emits the registered changed event", async () => {
  const { contributions, emitted } = await activate();
  const view = await contributions.actions.refresh.handler({}, { signal: new AbortController().signal });
  assert.equal(view.title, "Service Monitor");
  assert.ok(view.subtitle.includes("every 60s"));
  assertJsonWidgets(view.body);
  const widgets = collectWidgets(view.body);
  assert.ok(widgets.some((widget) => widget.type === "progress"));
  assert.ok(widgets.some((widget) => widget.type === "action" && widget.action === "refresh"));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, CHANGED_EVENT);
  assert.equal(emitted[0].properties.source, "refresh");
  assert.equal(emitted[0].properties.checked, 1);
});

test("loadConfig and saveConfig round-trip through ctx.config.update", async () => {
  const { contributions, persisted, emitted, readConfig } = await activate();
  const loaded = await contributions.actions.loadConfig.handler({}, { signal: new AbortController().signal });
  assert.deepEqual(loaded, {
    endpoint: "https://status.example.com",
    intervalSeconds: 60,
    verbose: false,
  });

  const saved = await contributions.actions.saveConfig.handler({
    endpoint: "https://status.internal",
    intervalSeconds: 15,
    verbose: true,
  }, { signal: new AbortController().signal });
  assert.deepEqual(saved, {
    saved: true,
    config: { endpoint: "https://status.internal", intervalSeconds: 15, verbose: true },
  });
  assert.deepEqual(readConfig(), saved.config);
  assert.deepEqual(persisted, [{
    plugins: {
      "service-monitor": {
        config: { endpoint: "https://status.internal", intervalSeconds: 15, verbose: true },
      },
    },
  }]);
  assert.equal(emitted.at(-1).type, CHANGED_EVENT);
  assert.equal(emitted.at(-1).properties.source, "saveConfig");

  const view = await contributions.actions.refresh.handler({}, { signal: new AbortController().signal });
  assert.ok(JSON.stringify(view).includes("15s"));
});

test("toolCard renders a neutral tool model and messageView renders an event payload", async () => {
  const { contributions } = await activate();
  const card = await contributions.actions.toolCard.handler({
    tool: "bash",
    status: "completed",
    input: { command: "npm test" },
    output: "ok",
  }, { signal: new AbortController().signal });
  assert.ok(card.title.includes("bash"));
  assert.ok(card.body.some((widget) => widget.type === "code"));
  assertJsonWidgets(card.body);

  const message = await contributions.actions.messageView.handler({
    checked: 2,
    at: "2026-11-03T00:00:00.000Z",
    source: "refresh",
  }, { signal: new AbortController().signal });
  assert.equal(message.title, "Service status changed");
  assert.ok(JSON.stringify(message.body).includes("2"));
  assert.ok(message.body.some((widget) => widget.type === "markdown"));
  assertJsonWidgets(message.body);
});
