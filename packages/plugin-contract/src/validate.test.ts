import { test } from "node:test"
import assert from "node:assert/strict"

import {
  PLUGIN_UI_LIMITS,
  normalizePluginView,
  validateClientDescriptor,
  validateConfigFormSchema,
  validatePluginManifestContributes,
} from "./index.ts"
import type { PluginClientDescriptor, PluginDescriptorValidation, PluginJsonSchema } from "./index.ts"

const SAMPLE_SCHEMA: PluginJsonSchema = {
  type: "object",
  title: "Sample settings",
  properties: {
    endpoint: { type: "string", title: "Endpoint", default: "" },
    retries: { type: "number", title: "Retries", minimum: 0, maximum: 10, default: 3 },
    enabled: { type: "boolean", title: "Enabled", default: true },
    mode: { type: "string", title: "Mode", enum: ["fast", "safe"], default: "fast" },
  },
  required: ["endpoint"],
  additionalProperties: false,
}

function validDescriptor(): PluginClientDescriptor {
  return {
    name: "sample",
    version: "1.0.0",
    revision: "boot-1:1",
    title: "Sample package",
    description: "Contract fixture",
    ui: {
      panels: [
        {
          id: "main",
          title: "Sample panel",
          icon: "layout-grid",
          order: 10,
          viewAction: "getPanel",
          refreshOn: ["plugin:sample:updated"],
        },
      ],
      toolCards: [
        {
          id: "search-card",
          tools: ["mafw_search_hybrid"],
          override: false,
          viewAction: "getToolCard",
        },
      ],
      configPages: [
        {
          id: "settings",
          title: "Settings",
          schema: SAMPLE_SCHEMA,
          loadAction: "loadConfig",
          saveAction: "saveConfig",
          reloadOnSave: true,
        },
      ],
      messageWindows: [
        {
          id: "alert",
          title: "Alert",
          triggerEvent: "plugin:sample:updated",
          viewAction: "getWindow",
          modal: false,
          dismissible: true,
        },
      ],
    },
    actions: [
      { name: "getPanel", title: "Get panel" },
      { name: "getToolCard" },
      { name: "loadConfig" },
      { name: "saveConfig" },
      { name: "getWindow" },
      { name: "refresh" },
    ],
    events: [
      {
        type: "plugin:sample:updated",
        title: "Updated",
        description: "Package data changed",
      },
    ],
    diagnostics: [{ level: "info", message: "loaded", code: "loaded" }],
  }
}

test("limits use the documented values", () => {
  assert.equal(PLUGIN_UI_LIMITS.maxWidgets, 256)
  assert.equal(PLUGIN_UI_LIMITS.maxDepth, 12)
  assert.equal(PLUGIN_UI_LIMITS.maxTextBytes, 64 * 1024)
  assert.equal(PLUGIN_UI_LIMITS.maxImageDataUrlBytes, 2 * 1024 * 1024)
  assert.equal(PLUGIN_UI_LIMITS.maxMenuItems, 20)
  assert.equal(PLUGIN_UI_LIMITS.maxComposerActions, 3)
  assert.equal(PLUGIN_UI_LIMITS.maxToolPayloadBytes, 256 * 1024)
  assert.equal(PLUGIN_UI_LIMITS.maxActionPayloadBytes, 256 * 1024)
  assert.equal(PLUGIN_UI_LIMITS.defaultActionTimeoutMs, 15_000)
  assert.equal(PLUGIN_UI_LIMITS.maxActionTimeoutMs, 60_000)
})

test("accepts a descriptor with every supported slot", () => {
  const result = validateClientDescriptor(validDescriptor())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.name, "sample")
  assert.equal(result.value.revision, "boot-1:1")
  assert.equal(result.value.ui.panels?.[0]?.viewAction, "getPanel")
  assert.equal(result.value.ui.configPages?.[0]?.reloadOnSave, true)
  assert.equal(result.value.ui.messageWindows?.[0]?.triggerEvent, "plugin:sample:updated")
  assert.equal(result.value.actions.length, 6)
  assert.equal(result.value.events.length, 1)
})

test("accepts a config form using text, number, boolean and select fields", () => {
  assert.deepEqual(validateConfigFormSchema(SAMPLE_SCHEMA), [])
})

test("normalizes a view with an action widget", () => {
  const view = normalizePluginView({
    title: "Sample",
    subtitle: "Panel body",
    body: [
      { type: "text", text: "hello" },
      { type: "code", text: "npm test", language: "bash" },
      { type: "kv", rows: [["a", "b"]] },
      { type: "tags", items: ["one", "two"] },
      { type: "list", items: ["plain", { type: "text", text: "nested" }] },
      { type: "row", children: [{ type: "text", text: "left" }] },
      { type: "link", text: "docs", href: "https://example.com" },
      { type: "markdown", text: "**bold**" },
      { type: "progress", value: 42, label: "42%" },
      { type: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      { type: "action", label: "Refresh", action: "refresh", input: { force: true }, style: "primary" },
    ],
  })
  assert.ok(view)
  const action = view!.body[10]
  assert.equal(action.type, "action")
  if (action.type !== "action") return
  assert.equal(action.action, "refresh")
  assert.deepEqual(action.input, { force: true })
  assert.equal(action.style, "primary")
})

test("rejects unknown UI slots", () => {
  const descriptor = validDescriptor() as unknown as Record<string, unknown>
  ;(descriptor.ui as Record<string, unknown>).statusBar = [{ id: "status" }]
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /unknown ui slot/i)
})

test("rejects cross-package action references", () => {
  const descriptor = validDescriptor()
  descriptor.ui.panels![0]!.viewAction = "other:getPanel"
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /cross-package action/i)
})

test("rejects unknown action references inside the package", () => {
  const descriptor = validDescriptor()
  descriptor.ui.toolCards![0]!.viewAction = "missingAction"
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /unknown action reference/i)
})

test("rejects unknown event references", () => {
  const descriptor = validDescriptor()
  descriptor.ui.panels![0]!.refreshOn = ["plugin:sample:missing"]
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /unknown event reference/i)
})

test("rejects event declarations outside the package namespace", () => {
  const descriptor = validDescriptor()
  descriptor.events[0]!.type = "plugin:other:updated"
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /plugin:<package>:/)
})

test("rejects duplicate ids and duplicate action names", () => {
  const duplicatePanel = validDescriptor()
  duplicatePanel.ui.panels!.push({ ...duplicatePanel.ui.panels![0]! })
  const panelResult = validateClientDescriptor(duplicatePanel)
  assert.equal(panelResult.ok, false)
  if (!panelResult.ok) assert.match(panelResult.error, /duplicate/i)

  const duplicateAction = validDescriptor()
  duplicateAction.actions.push({ name: "getPanel" })
  const actionResult = validateClientDescriptor(duplicateAction)
  assert.equal(actionResult.ok, false)
  if (!actionResult.ok) assert.match(actionResult.error, /duplicate/i)
})

test("rejects unknown descriptor fields so Host code cannot leak to clients", () => {
  const descriptor = validDescriptor() as unknown as Record<string, unknown>
  descriptor.handlers = { getPanel: () => "nope" }
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /unknown descriptor field/i)
})

test("rejects action timeouts above the hard maximum", () => {
  const descriptor = validDescriptor()
  descriptor.actions[0]!.timeoutMs = PLUGIN_UI_LIMITS.maxActionTimeoutMs + 1
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /timeout/i)
})

test("rejects invalid config field kinds", () => {
  const schema: PluginJsonSchema = {
    type: "object",
    properties: { upload: { type: "file" } },
  }
  const errors = validateConfigFormSchema(schema)
  assert.ok(errors.length > 0)
  assert.match(errors.join("\n"), /unsupported config field kind.*file/i)

  const descriptor = validDescriptor()
  descriptor.ui.configPages![0]!.schema = schema
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /config page "settings"/i)
})

test("fails closed on a circular config page schema instead of throwing", () => {
  const circularSchema: Record<string, unknown> = { type: "object", properties: {} }
  ;(circularSchema.properties as Record<string, unknown>).loop = circularSchema
  const descriptor = validDescriptor()
  descriptor.ui.configPages![0]!.schema = circularSchema as unknown as PluginJsonSchema

  let result: PluginDescriptorValidation | undefined
  assert.doesNotThrow(() => {
    result = validateClientDescriptor(descriptor)
  })
  assert.ok(result)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /JSON-serializable/i)
})

test("fails closed on a BigInt-bearing config page schema instead of throwing", () => {
  const descriptor = validDescriptor()
  descriptor.ui.configPages![0]!.schema = {
    type: "object",
    properties: { retries: { type: "number", default: 3n } },
  }

  let result: PluginDescriptorValidation | undefined
  assert.doesNotThrow(() => {
    result = validateClientDescriptor(descriptor)
  })
  assert.ok(result)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /JSON-serializable/i)
})

test("rejects secret/format fields in config forms", () => {
  const schema: PluginJsonSchema = {
    type: "object",
    properties: { token: { type: "string", format: "password" } },
  }
  const errors = validateConfigFormSchema(schema)
  assert.ok(errors.some((e) => /unsupported config field keyword.*format/i.test(e)))
})

test("rejects config defaults that do not match the field type", () => {
  const schema: PluginJsonSchema = {
    type: "object",
    properties: { retries: { type: "number", default: "many" } },
  }
  assert.ok(validateConfigFormSchema(schema).some((e) => /default/i.test(e)))
})

test("rejects required fields that are not declared", () => {
  const schema: PluginJsonSchema = {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["missing"],
  }
  assert.ok(validateConfigFormSchema(schema).some((e) => /required/i.test(e)))
})

test("rejects a view deeper than the depth limit", () => {
  function nest(levels: number): unknown {
    let node: unknown = { type: "text", text: "leaf" }
    for (let i = 1; i < levels; i += 1) node = { type: "row", children: [node] }
    return node
  }
  assert.ok(normalizePluginView({ body: [nest(PLUGIN_UI_LIMITS.maxDepth)] }))
  assert.equal(normalizePluginView({ body: [nest(PLUGIN_UI_LIMITS.maxDepth + 1)] }), null)
})

test("rejects a view with more widgets than the node limit", () => {
  const makeBody = (count: number) => Array.from({ length: count }, () => ({ type: "text", text: "x" }))
  assert.ok(normalizePluginView({ body: makeBody(PLUGIN_UI_LIMITS.maxWidgets) }))
  assert.equal(normalizePluginView({ body: makeBody(PLUGIN_UI_LIMITS.maxWidgets + 1) }), null)
})

test("rejects text larger than the text limit instead of truncating", () => {
  const exact = "x".repeat(PLUGIN_UI_LIMITS.maxTextBytes)
  const view = normalizePluginView({ body: [{ type: "text", text: exact }] })
  assert.ok(view)
  assert.equal((view!.body[0] as { text: string }).text.length, exact.length)
  assert.equal(normalizePluginView({ body: [{ type: "text", text: `${exact}x` }] }), null)
})

test("rejects image widgets whose source is not a data:image URL", () => {
  assert.equal(normalizePluginView({ body: [{ type: "image", dataUrl: "https://example.com/a.png" }] }), null)
  assert.equal(normalizePluginView({ body: [{ type: "image", dataUrl: "data:text/html;base64,AAAA" }] }), null)
})

test("rejects image data URLs larger than the image limit", () => {
  const tooLarge = `data:image/png;base64,${"A".repeat(PLUGIN_UI_LIMITS.maxImageDataUrlBytes)}`
  assert.equal(normalizePluginView({ body: [{ type: "image", dataUrl: tooLarge }] }), null)
})

test("rejects action widget inputs larger than the action payload limit", () => {
  const tooLarge = "x".repeat(PLUGIN_UI_LIMITS.maxActionPayloadBytes + 1)
  const view = normalizePluginView({ body: [{ type: "action", label: "Go", action: "refresh", input: { value: tooLarge } }] })
  assert.equal(view, null)
})

test("fails closed on malformed views but keeps unknown widgets as text", () => {
  assert.equal(normalizePluginView({ title: "No body" }), null)
  assert.equal(normalizePluginView("not a view"), null)
  const view = normalizePluginView({ body: [{ type: "sparkline", value: 1 }] })
  assert.ok(view)
  assert.equal(view!.body[0]!.type, "text")
  assert.match((view!.body[0] as { text: string }).text, /sparkline/)
})

test("validates panel order and required string fields", () => {
  const descriptor = validDescriptor()
  descriptor.ui.panels![0]!.order = Number.NaN
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /order/i)
})

test("trims unsupported optional values and keeps the DTO serializable", () => {
  const descriptor = validDescriptor()
  descriptor.ui.toolCards![0]!.override = "yes" as unknown as boolean
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /override/i)
})

test("preserves event scope on the client descriptor", () => {
  const descriptor = validDescriptor()
  descriptor.events[0]!.scope = "session"
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.events[0]!.scope, "session")
})

test("keeps scope absent when the declaration does not set it", () => {
  const result = validateClientDescriptor(validDescriptor())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal("scope" in result.value.events[0]!, false)
})

test("rejects an invalid event scope", () => {
  const descriptor = validDescriptor()
  descriptor.events[0]!.scope = "forever" as unknown as "global"
  const result = validateClientDescriptor(descriptor)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /scope/i)
})

test("webSurfaces: defaults entry/scope/reload and builds the gateway URL", () => {
  const result = validateClientDescriptor({
    name: "demo", version: "1.0.0", revision: "r1",
    ui: { webSurfaces: [{ id: "panel", title: "Demo", rail: { icon: "layout-grid" } }] },
    actions: [], events: [],
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.ui.webSurfaces, [{
    id: "panel", title: "Demo", entry: "index.html", scope: "session",
    reloadOnSessionChange: true, url: "/api/plugins/demo/ui/index.html",
    rail: { icon: "layout-grid", order: 100, badge: false },
  }])
})

test("webSurfaces: rejects traversal/absolute entries and unknown icons", () => {
  for (const entry of ["../x.html", "/etc/passwd", "a/../../b.html", "a\\..\\b.html"]) {
    const r = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
      ui: { webSurfaces: [{ id: "p", title: "P", entry }] }, actions: [], events: [] })
    assert.equal(r.ok, false)
  }
  const icon = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
    ui: { webSurfaces: [{ id: "p", title: "P", rail: { icon: "not-a-real-icon" } }] }, actions: [], events: [] })
  assert.equal(icon.ok, false)
})

test("webSurfaces: id collides with panels and unknown fields reject", () => {
  const collide = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
    ui: { panels: [{ id: "p", title: "P", viewAction: "v" }],
          webSurfaces: [{ id: "p", title: "P" }] },
    actions: [{ name: "v" }], events: [] })
  assert.equal(collide.ok, false)
  const extra = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
    ui: { webSurfaces: [{ id: "p", title: "P", url: "https://evil" }] }, actions: [], events: [] })
  assert.equal(extra.ok, false)
})

test("manifest contributes: accepts gateway and desktop planes", () => {
  const result = validatePluginManifestContributes({
    gateway: { actions: ["refresh"], events: ["plugin:demo:changed"], http: true },
    desktop: {
      ui: { panels: [{ id: "main", title: "Main", viewAction: "refresh" }] },
      web: { webSurfaces: [{ id: "explorer", title: "Explorer" }] },
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.gateway?.actions, ["refresh"])
  assert.equal(result.value.desktop?.web?.webSurfaces?.length, 1)
})

test("manifest contributes: accepts desktop-only and gateway-only", () => {
  assert.equal(validatePluginManifestContributes({ desktop: { ui: {} } }).ok, true)
  assert.equal(validatePluginManifestContributes({ gateway: { http: true } }).ok, true)
})

test("manifest contributes: rejects unknown plane keys", () => {
  assert.equal(validatePluginManifestContributes({ gatewayx: {} }).ok, false)
  const desktop = validatePluginManifestContributes({ desktop: { unknown: {} } })
  assert.equal(desktop.ok, false)
  if (desktop.ok) return
  assert.match(desktop.error, /desktop/i)
})

test("manifest contributes: rejects an unknown key inside gateway", () => {
  // Guards the widened allow-list: `observer` is not a plane, only `observers` is.
  assert.equal(validatePluginManifestContributes({ gateway: { observer: [] } }).ok, false)
})

test("manifest contributes: rejects non-object ui and invalid main", () => {
  const ui = validatePluginManifestContributes({ desktop: { ui: [] } })
  assert.equal(ui.ok, false)
  const main = validatePluginManifestContributes({ desktop: { main: { legacy: false } } })
  assert.equal(main.ok, false)
})

test("manifest contributes: accepts the legacy singleton planes", () => {
  const result = validatePluginManifestContributes({
    gateway: {
      runtime: { name: "my-runtime" },
      media: { name: "my-media", modalities: ["image", "video"] },
      tts: { name: "my-tts" },
      usage: { name: "my-usage" },
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.gateway?.runtime, { name: "my-runtime" })
  assert.deepEqual(result.value.gateway?.media, {
    name: "my-media",
    modalities: ["image", "video"],
  })
  assert.deepEqual(result.value.gateway?.tts, { name: "my-tts" })
  assert.deepEqual(result.value.gateway?.usage, { name: "my-usage" })
})

test("manifest contributes: accepts a legacy plane declared without fields", () => {
  // `{}` is a real declaration: the name then defaults to the package name.
  const result = validatePluginManifestContributes({ gateway: { runtime: {}, media: {} } })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.gateway?.runtime, {})
  assert.deepEqual(result.value.gateway?.media, {})
})

test("manifest contributes: rejects malformed legacy plane declarations", () => {
  const runtime = validatePluginManifestContributes({ gateway: { runtime: "x" } })
  assert.equal(runtime.ok, false)
  assert.match(
    runtime.ok ? "" : runtime.error,
    /manifest contributes\.gateway\.runtime must be an object/,
  )

  const modalities = validatePluginManifestContributes({
    gateway: { media: { modalities: "image" } },
  })
  assert.equal(modalities.ok, false)

  // The planes are closed objects: an unknown field is a typo, not vendor
  // metadata (handlers still come from `activate()`).
  const extra = validatePluginManifestContributes({
    gateway: { runtime: { name: "r", extra: 1 } },
  })
  assert.equal(extra.ok, false)
  assert.match(extra.ok ? "" : extra.error, /manifest contributes\.gateway\.runtime has unknown field "extra"/)

  const mediaExtra = validatePluginManifestContributes({
    gateway: { media: { name: "m", modalities: ["image"], extra: 1 } },
  })
  assert.equal(mediaExtra.ok, false)

  for (const contributes of [
    { gateway: { tts: { name: 2 } } },
    { gateway: { usage: { name: "" } } },
    { gateway: { media: { modalities: [1] } } },
    { gateway: { media: [] } },
  ]) {
    assert.equal(
      validatePluginManifestContributes(contributes).ok,
      false,
      JSON.stringify(contributes),
    )
  }
})

test("menuItems: accepts a valid menu declaration", () => {
  const result = validateClientDescriptor({
    ...validDescriptor(),
    ui: {
      panels: [{ id: "main", title: "Main", viewAction: "getPanel" }],
      menuItems: [
        {
          id: "copy-md",
          surface: "message",
          label: "Copy markdown",
          action: "getPanel",
          icon: "file",
          shortcut: "Ctrl+Shift+C",
          order: 10,
        },
      ],
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.ui.menuItems?.[0]?.id, "copy-md")
  assert.equal(result.value.ui.menuItems?.[0]?.surface, "message")
})

test("menuItems: rejects unknown surface, action, icon and duplicate ids", () => {
  for (const item of [
    { id: "x", surface: "unknown", label: "X", action: "getPanel" },
    { id: "x", surface: "message", label: "X", action: "other:action" },
    { id: "x", surface: "message", label: "X", action: "missing" },
    { id: "x", surface: "message", label: "X", action: "getPanel", icon: "nope" },
    { id: "x", surface: "message", label: "X", action: "getPanel", danger: true },
  ]) {
    const result = validateClientDescriptor({ ...validDescriptor(), ui: { menuItems: [item] } })
    assert.equal(result.ok, false)
  }

  const duplicate = validateClientDescriptor({
    ...validDescriptor(),
    ui: {
      menuItems: [
        { id: "same", surface: "message", label: "A", action: "getPanel" },
        { id: "same", surface: "message", label: "B", action: "getPanel" },
      ],
    },
  })
  assert.equal(duplicate.ok, false)
})

test("panel rail: accepts a registered icon and rejects invalid rail fields", () => {
  const ok = validateClientDescriptor({
    ...validDescriptor(),
    ui: {
      panels: [
        {
          id: "main",
          title: "Main",
          viewAction: "getPanel",
          rail: { icon: "layout-grid", order: 10, badge: true },
        },
      ],
    },
  })
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.deepEqual(ok.value.ui.panels?.[0]?.rail, {
    icon: "layout-grid",
    order: 10,
    badge: true,
  })

  for (const rail of [
    { icon: "not-a-real-icon" },
    { icon: "layout-grid", extra: true },
    { icon: "layout-grid", badge: "yes" },
  ]) {
    const result = validateClientDescriptor({
      ...validDescriptor(),
      ui: {
        panels: [{ id: "main", title: "Main", viewAction: "getPanel", rail }],
      },
    })
    assert.equal(result.ok, false)
  }
})

test("composerActions: accepts a valid action and rejects bad references", () => {
  const ok = validateClientDescriptor({
    ...validDescriptor(),
    ui: {
      composerActions: [
        { id: "draft", label: "Draft reply", action: "getPanel", icon: "bubble-5", order: 10 },
      ],
    },
  })
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.equal(ok.value.ui.composerActions?.[0]?.id, "draft")

  for (const item of [
    { id: "x", label: "X", action: "missing" },
    { id: "x", label: "X", action: "getPanel", icon: "nope" },
    { id: "x", label: "", action: "getPanel" },
  ]) {
    const result = validateClientDescriptor({
      ...validDescriptor(),
      ui: { composerActions: [item] },
    })
    assert.equal(result.ok, false)
  }

  const tooMany = validateClientDescriptor({
    ...validDescriptor(),
    ui: {
      composerActions: Array.from({ length: 4 }, (_, index) => ({
        id: `a${index}`,
        label: `A${index}`,
        action: "getPanel",
      })),
    },
  })
  assert.equal(tooMany.ok, false)
})

test("manifest contributes: accepts gateway tools", () => {
  const result = validatePluginManifestContributes({
    gateway: {
      tools: [
        {
          name: "echo",
          title: "Echo",
          description: "Echo input",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
          scope: "session",
        },
      ],
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.gateway?.tools?.[0].name, "echo")
  assert.equal(result.value.gateway?.tools?.[0].scope, "session")
})

test("manifest contributes: rejects bad tool names, timeouts and unknown fields", () => {
  for (const name of ["", "a:b", "bad name", " plugin"]) {
    const result = validatePluginManifestContributes({
      gateway: { tools: [{ name, description: "x", inputSchema: {} }] },
    })
    assert.equal(result.ok, false)
  }

  const timeout = validatePluginManifestContributes({
    gateway: { tools: [{ name: "ok", description: "x", inputSchema: {}, timeoutMs: 0 }] },
  })
  assert.equal(timeout.ok, false)

  const tooLong = validatePluginManifestContributes({
    gateway: { tools: [{ name: "ok", description: "x", inputSchema: {}, timeoutMs: 60001 }] },
  })
  assert.equal(tooLong.ok, false)

  const extra = validatePluginManifestContributes({
    gateway: { tools: [{ name: "ok", description: "x", inputSchema: {}, handler: "nope" }] },
  })
  assert.equal(extra.ok, false)

  const scope = validatePluginManifestContributes({
    gateway: { tools: [{ name: "ok", description: "x", inputSchema: {}, scope: "global" }] },
  })
  assert.equal(scope.ok, true)
})

test("manifest contributes: accepts gateway observers", () => {
  const result = validatePluginManifestContributes({ gateway: { observers: ["audit", "metrics"] } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.gateway?.observers : undefined, ["audit", "metrics"]);
});

test("manifest contributes: rejects a non-array observers value", () => {
  const result = validatePluginManifestContributes({ gateway: { observers: "audit" } });
  assert.equal(result.ok, false);
  // Pinned against `readStringList`, which owns the shared wording and label.
  assert.match(
    result.ok ? "" : result.error,
    /manifest contributes\.gateway\.observers must be an array of non-empty strings/,
  );
});

test("manifest contributes: existing client descriptor validation is unchanged", () => {
  const result = validateClientDescriptor(validDescriptor())
  assert.equal(result.ok, true)
})
