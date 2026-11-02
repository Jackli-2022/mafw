// Task 9: declarative config form model + request controller.
//
// The form only understands the restricted schema subset published by
// `@mafw/plugin-contract` (text/number/integer/boolean/select). Secret or
// unsupported fields are dropped before they can render or be submitted.
import { describe, expect, test } from "bun:test"
import type { PluginClientDescriptor, PluginJsonSchema } from "@mafw/plugin-contract"
import {
  createPluginConfigController,
  formFields,
  initialFormValues,
  validateFormValues,
  type ConfigFormValues,
  type PluginConfigControllerDeps,
} from "./plugin-config-form"
import { planPluginTabs, pluginConfigSurfaces, pluginSurfaces } from "./plugin-view-model"
import type { PluginGeneration } from "./plugin-client"

const schema: PluginJsonSchema = {
  type: "object",
  properties: {
    host: { type: "string", title: "Host", default: "localhost", minLength: 1 },
    port: { type: "integer", title: "Port", default: 8080, minimum: 1, maximum: 65535 },
    ratio: { type: "number", default: 0.5, minimum: 0, maximum: 1 },
    enabled: { type: "boolean", default: true },
    mode: { type: "string", title: "Mode", enum: ["fast", "slow"], default: "slow" },
    // Must never render or echo: explicit secret markers and unsupported kinds.
    apiKey: { type: "string", format: "password" },
    token: { type: "string", secret: true },
    nested: { type: "object" },
    list: { type: "array" },
  },
  required: ["host", "port"],
}

const generation = (revision: string): PluginGeneration => {
  const separator = revision.lastIndexOf(":")
  return {
    bootId: separator > 0 ? revision.slice(0, separator) : revision,
    counter: separator > 0 ? Number(revision.slice(separator + 1)) : 0,
    revision,
  }
}

const defaults = (): ConfigFormValues => ({
  host: "localhost",
  port: 8080,
  ratio: 0.5,
  enabled: true,
  mode: "slow",
})

interface ControllerHarness {
  deps: PluginConfigControllerDeps
  loads: number
  saves: ConfigFormValues[]
  reloads: number
  setLoadOutput: (value: unknown) => void
  setSaveOutput: (value: unknown) => void
  setCurrent: (value: boolean) => void
  setReloadOnSave: (value: boolean) => void
}

function harness(overrides: Partial<PluginConfigControllerDeps> = {}): ControllerHarness {
  let loadOutput: unknown = defaults()
  let saveOutput: unknown = undefined
  let current = true
  let reloadOnSave = false
  const state = { loads: 0, saves: [] as ConfigFormValues[], reloads: 0 }

  const deps: PluginConfigControllerDeps = {
    schema: () => schema,
    identity: () => ({ revision: "rev-1", pageId: "settings" }),
    load: async () => {
      state.loads += 1
      return loadOutput
    },
    save: async (values) => {
      state.saves.push({ ...values })
      return saveOutput
    },
    reload: async () => {
      state.reloads += 1
      return { ok: true }
    },
    reloadOnSave: () => reloadOnSave,
    generation: () => generation("boot-a:1"),
    isGenerationCurrent: () => current,
    ...overrides,
  }

  return {
    deps,
    get loads() {
      return state.loads
    },
    get saves() {
      return state.saves
    },
    get reloads() {
      return state.reloads
    },
    setLoadOutput: (value) => {
      loadOutput = value
    },
    setSaveOutput: (value) => {
      saveOutput = value
    },
    setCurrent: (value) => {
      current = value
    },
    setReloadOnSave: (value) => {
      reloadOnSave = value
    },
  }
}

describe("formFields", () => {
  test("renders text, number, integer, boolean and select fields", () => {
    const fields = formFields(schema)
    expect(fields.map((field) => [field.name, field.kind])).toEqual([
      ["host", "text"],
      ["port", "integer"],
      ["ratio", "number"],
      ["enabled", "boolean"],
      ["mode", "select"],
    ])
    expect(fields[1]?.minimum).toBe(1)
    expect(fields[1]?.maximum).toBe(65535)
    expect(fields[4]?.options.map((option) => option.value)).toEqual(["fast", "slow"])
    expect(fields[0]?.required).toBe(true)
    expect(fields[2]?.required).toBe(false)
  })

  test("never renders secret, unsupported or forbidden fields", () => {
    const fields = formFields(schema)
    const names = fields.map((field) => field.name)
    expect(names).not.toContain("apiKey")
    expect(names).not.toContain("token")
    expect(names).not.toContain("nested")
    expect(names).not.toContain("list")

    const hostile = formFields({
      type: "object",
      properties: {
        ok: { type: "string" },
        constructor: { type: "string" },
        writeOnly: { type: "string", writeOnly: true },
        secretFormat: { type: "string", format: "secret" },
        ...(JSON.parse('{"__proto__":{"type":"string"}}') as Record<string, PluginJsonSchema>),
      },
    })
    expect(hostile.map((field) => field.name)).toEqual(["ok"])
  })

  test("degrades malformed schemas to an empty field list", () => {
    expect(formFields({ type: "object" })).toEqual([])
    expect(formFields({ type: "object", properties: [] as unknown as Record<string, never> })).toEqual([])
  })

  test("supports numeric and boolean enum selects", () => {
    const enums: PluginJsonSchema = {
      type: "object",
      properties: {
        level: { type: "integer", enum: [1, 2, 3], default: 2 },
        flag: { type: "boolean", enum: [true, false], default: false },
      },
    }
    const fields = formFields(enums)
    expect(fields.map((field) => field.kind)).toEqual(["select", "select"])
    expect(fields[0]?.options.map((option) => option.value)).toEqual([1, 2, 3])
    expect(fields[1]?.options.map((option) => option.value)).toEqual([true, false])
    const values = initialFormValues(enums, { level: 3, flag: true })
    expect(values).toEqual({ level: 3, flag: true })
    expect(validateFormValues(enums, { level: 9, flag: true })).toEqual([
      'field "level" must be one of: 1, 2, 3',
    ])
  })
})

describe("initialFormValues", () => {
  test("applies text/number/boolean/select defaults", () => {
    expect(initialFormValues(schema, undefined)).toEqual(defaults())
  })

  test("prefers loaded values, drops unknown keys and falls back on invalid types", () => {
    const values = initialFormValues(schema, {
      host: "example.test",
      port: 9000,
      ratio: "not-a-number",
      enabled: false,
      mode: "fast",
      unknown: "ignored",
      apiKey: "should-never-be-echoed",
      token: "should-never-be-echoed",
    })
    expect(values).toEqual({
      host: "example.test",
      port: 9000,
      ratio: 0.5,
      enabled: false,
      mode: "fast",
    })
    expect(Object.keys(values).sort()).toEqual(["enabled", "host", "mode", "port", "ratio"])
  })

  test("rejects loaded values outside the select enum or integer shape", () => {
    const values = initialFormValues(schema, { port: 80.5, mode: "turbo" })
    expect(values.port).toBe(8080)
    expect(values.mode).toBe("slow")
  })
})

describe("validateFormValues", () => {
  test("accepts complete valid values", () => {
    expect(validateFormValues(schema, defaults())).toEqual([])
  })

  test("requires required fields, including non-empty text", () => {
    expect(validateFormValues(schema, {})).toEqual([
      'field "host" is required',
      'field "port" is required',
    ])
    expect(validateFormValues(schema, { ...defaults(), host: "   " })).toContain(
      'field "host" is required',
    )
  })

  test("rejects unknown fields instead of leaking them to the save action", () => {
    expect(validateFormValues(schema, { ...defaults(), extra: true })).toEqual([
      'unknown config field "extra"',
    ])
  })

  test("enforces enum, integer, range, length and pattern constraints", () => {
    expect(validateFormValues(schema, { ...defaults(), mode: "turbo" })).toContain(
      'field "mode" must be one of: fast, slow',
    )
    expect(validateFormValues(schema, { ...defaults(), port: 80.5 })).toContain(
      'field "port" must be an integer',
    )
    expect(validateFormValues(schema, { ...defaults(), port: 0 })).toContain(
      'field "port" must be at least 1',
    )
    expect(validateFormValues(schema, { ...defaults(), host: "" })).toContain(
      'field "host" is required',
    )

    const patterned: PluginJsonSchema = {
      type: "object",
      properties: { slug: { type: "string", pattern: "^[a-z]+$" } },
    }
    expect(validateFormValues(patterned, { slug: "NOPE" })).toEqual([
      'field "slug" must match ^[a-z]+$',
    ])
  })
})

describe("plugin config controller", () => {
  test("loads action output into the form", async () => {
    const h = harness()
    const controller = createPluginConfigController(h.deps)
    await controller.load()

    expect(h.loads).toBe(1)
    expect(controller.state().status).toBe("ready")
    expect(controller.state().values).toEqual(defaults())
    expect(controller.state().stale).toBe(false)
  })

  test("save success submits current values and updates the baseline", async () => {
    const h = harness()
    h.setSaveOutput({ ...defaults(), host: "saved.test" })
    const controller = createPluginConfigController(h.deps)
    await controller.load()
    controller.setValue("host", "draft.test")

    await controller.save()

    expect(h.saves).toEqual([{ ...defaults(), host: "draft.test" }])
    expect(controller.state().status).toBe("ready")
    expect(controller.state().values.host).toBe("saved.test")
    expect(controller.state().baseline.host).toBe("saved.test")
    expect(controller.state().error).toBeNull()
    expect(h.reloads).toBe(0)
  })

  test("reloadOnSave triggers exactly one reload after a successful save", async () => {
    const h = harness()
    h.setReloadOnSave(true)
    const controller = createPluginConfigController(h.deps)
    await controller.load()

    await controller.save()

    expect(h.saves).toHaveLength(1)
    expect(h.reloads).toBe(1)

    // A second explicit save is a second successful save: one more reload.
    await controller.save()
    expect(h.reloads).toBe(2)
  })

  test("save failure keeps the draft and reports a neutral error", async () => {
    const h = harness()
    h.deps.save = async (values) => {
      h.saves.push({ ...values })
      throw new Error("disk is read-only")
    }
    h.setReloadOnSave(true)
    const controller = createPluginConfigController(h.deps)
    await controller.load()
    controller.setValue("host", "draft.test")

    await controller.save()

    expect(controller.state().status).toBe("ready")
    expect(controller.state().values.host).toBe("draft.test")
    expect(controller.state().error).toBe("保存失败：disk is read-only")
    expect(h.reloads).toBe(0)
  })

  test("disables the form while a save is pending", async () => {
    let release: (() => void) | null = null
    const h = harness()
    h.deps.save = (values) =>
      new Promise((resolve) => {
        h.saves.push({ ...values })
        release = () => resolve(undefined)
      })
    const controller = createPluginConfigController(h.deps)
    await controller.load()

    const pending = controller.save()
    expect(controller.state().status).toBe("saving")
    release?.()
    await pending
    expect(controller.state().status).toBe("ready")
  })

  test("validation failure never invokes the save action", async () => {
    const h = harness()
    const controller = createPluginConfigController(h.deps)
    await controller.load()
    controller.setValue("host", "")

    await controller.save()

    expect(h.saves).toEqual([])
    expect(controller.state().errors).toContain('field "host" is required')
  })

  test("responses from an older plugin generation are discarded", async () => {
    let current = true
    const h = harness({ isGenerationCurrent: () => current })
    h.setSaveOutput({ ...defaults(), host: "saved.test" })
    const controller = createPluginConfigController(h.deps)
    await controller.load()
    controller.setValue("host", "draft.test")

    h.deps.save = async (values) => {
      h.saves.push({ ...values })
      current = false
      return { ...defaults(), host: "saved.test" }
    }
    h.setReloadOnSave(true)

    await controller.save()

    expect(controller.state().values.host).toBe("draft.test")
    expect(controller.state().stale).toBe(true)
    expect(controller.state().status).toBe("ready")
    expect(h.reloads).toBe(0)
  })

  test("a plugin revision change marks a dirty draft stale and requires reload", async () => {
    const h = harness()
    let identity = { revision: "rev-1", pageId: "settings" }
    const controller = createPluginConfigController({
      ...h.deps,
      identity: () => identity,
    })
    await controller.load()
    controller.setValue("host", "draft.test")

    identity = { revision: "rev-2", pageId: "settings" }
    controller.checkIdentity("rev-2", "settings")

    expect(controller.state().stale).toBe(true)
    expect(controller.state().values.host).toBe("draft.test")
    expect(controller.state().error).toContain("重新加载")
    expect(h.loads).toBe(1)

    await controller.save()
    expect(h.saves).toEqual([])

    h.setLoadOutput({ ...defaults(), host: "fresh.test" })
    await controller.reload()
    expect(controller.state().stale).toBe(false)
    expect(controller.state().values.host).toBe("fresh.test")
    expect(controller.state().status).toBe("ready")
  })

  test("a plugin revision change without a dirty draft reloads automatically", async () => {
    const h = harness()
    let identity = { revision: "rev-1", pageId: "settings" }
    const controller = createPluginConfigController({
      ...h.deps,
      identity: () => identity,
    })
    await controller.load()
    h.setLoadOutput({ ...defaults(), host: "rev2.test" })

    identity = { revision: "rev-2", pageId: "settings" }
    controller.checkIdentity("rev-2", "settings")
    await controller.load()

    expect(controller.state().values.host).toBe("rev2.test")
    expect(controller.state().stale).toBe(false)
  })

  test("identity changes while loading discard the old response and retry", async () => {
    let release: (() => void) | null = null
    let identity = { revision: "rev-1", pageId: "settings" }
    let calls = 0
    const h = harness({
      identity: () => identity,
      load: () => {
        calls += 1
        if (calls > 1) return Promise.resolve({ ...defaults(), host: "fresh.test" })
        return new Promise((resolve) => {
          release = () => resolve({ ...defaults(), host: "old.test" })
        })
      },
    })
    const controller = createPluginConfigController(h.deps)

    const pending = controller.load()
    identity = { revision: "rev-2", pageId: "settings" }
    release?.()
    await pending

    expect(calls).toBe(2)
    expect(controller.state().values.host).toBe("fresh.test")
    expect(controller.state().status).toBe("ready")
  })
})

describe("plugin config surfaces", () => {
  const descriptor = (overrides: Partial<PluginClientDescriptor> = {}): PluginClientDescriptor => ({
    name: "acme",
    version: "1.0.0",
    revision: "boot-a:1",
    title: "Acme",
    ui: {
      configPages: [
        { id: "settings", title: "Settings", schema, loadAction: "load", saveAction: "save" },
      ],
    },
    actions: [
      { name: "load" },
      { name: "save" },
      { name: "view" },
    ],
    events: [],
    ...overrides,
  })

  test("projects declared config pages as namespaced L2 tabs", () => {
    const surfaces = pluginConfigSurfaces([descriptor()])
    expect(surfaces).toHaveLength(1)
    expect(surfaces[0]?.id).toBe("plugin:acme:config.settings")
    expect(surfaces[0]?.label).toBe("Settings")
    expect(surfaces[0]?.page.id).toBe("settings")
  })

  test("drops pages whose load/save action is not declared", () => {
    const surfaces = pluginConfigSurfaces([
      descriptor({
        ui: {
          configPages: [
            { id: "ghost", title: "Ghost", schema, loadAction: "ghost", saveAction: "save" },
            { id: "half", title: "Half", schema, loadAction: "load", saveAction: "ghost" },
          ],
        },
      }),
    ])
    expect(surfaces).toEqual([])
  })

  test("a config page id never collides with a panel id", () => {
    const surfaces = pluginConfigSurfaces([
      descriptor({
        ui: {
          configPages: [
            { id: "settings", title: "Settings", schema, loadAction: "load", saveAction: "save" },
          ],
          panels: [{ id: "settings", title: "Settings panel", viewAction: "view" }],
        },
      }),
    ])
    const ids = [
      ...pluginSurfaces([descriptor({
        ui: { panels: [{ id: "settings", title: "Settings panel", viewAction: "view" }] },
      })]).map((surface) => surface.id),
      ...surfaces.map((surface) => surface.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("mixed panel and config tabs share the overflow plan", () => {
    const tabs = [
      ...pluginSurfaces([descriptor({
        ui: { panels: [{ id: "one", title: "One", viewAction: "view" }] },
      })]),
      ...pluginConfigSurfaces([descriptor()]),
    ]
    const plan = planPluginTabs(tabs, { capacity: 1, activeId: "plugin:acme:config.settings" })
    expect(plan.visible.map((surface) => surface.id)).toEqual(["plugin:acme:config.settings"])
    expect(plan.overflow.map((surface) => surface.id)).toEqual(["plugin:acme:one"])
  })
})
