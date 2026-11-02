// Task 9: restricted config-form model and request controller.
//
// The descriptor schema is already validated by the gateway against the shared
// subset in `@mafw/plugin-contract`, but Desktop still treats it as untrusted
// data: unsupported/secret fields are dropped, unknown loaded values are
// ignored, and unknown draft fields are rejected before the save action runs.
//
// The controller owns fetch/save sequencing so the Solid component stays a
// thin binding layer. It captures the plugin generation + page identity before
// every await and discards responses that belong to an older revision.
import {
  createSignal as solidCreateSignal,
  untrack as solidUntrack,
  type Accessor,
  type Setter,
} from "solid-js"
import type { PluginJsonSchema } from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"

export type ConfigPrimitive = string | number | boolean
export type ConfigFormValues = Record<string, ConfigPrimitive>

export type ConfigFieldKind = "text" | "number" | "integer" | "boolean" | "select"

export interface ConfigSelectOption {
  value: ConfigPrimitive
  label: string
}

export interface ConfigField {
  name: string
  kind: ConfigFieldKind
  label: string
  description?: string
  required: boolean
  options: ConfigSelectOption[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  default: ConfigPrimitive
}

/** Field formats that must never be rendered, even if a bad schema slips through. */
const SECRET_FORMATS = new Set(["password", "secret", "token"])
const FORBIDDEN_FIELD_NAMES = new Set(["__proto__", "prototype", "constructor"])
const FIELD_KINDS = new Set(["string", "number", "integer", "boolean"])

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function matchesKind(value: unknown, kind: ConfigFieldKind): value is ConfigPrimitive {
  switch (kind) {
    case "text":
      return isString(value)
    case "select":
      // Enum selects may be backed by any primitive kind in the subset.
      return isString(value) || finiteNumber(value) || typeof value === "boolean"
    case "number":
      return finiteNumber(value)
    case "integer":
      return finiteNumber(value) && Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
  }
}

function fieldKindOf(schema: PlainObject): ConfigFieldKind | null {
  if (!isString(schema.type) || !FIELD_KINDS.has(schema.type)) return null
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "select"
  switch (schema.type) {
    case "string":
      return "text"
    case "number":
      return "number"
    case "integer":
      return "integer"
    case "boolean":
      return "boolean"
    default:
      return null
  }
}

function isSecretField(schema: PlainObject): boolean {
  if (schema.secret === true || schema.writeOnly === true) return true
  return isString(schema.format) && SECRET_FORMATS.has(schema.format.toLowerCase())
}

function enumOptions(schema: PlainObject, kind: ConfigFieldKind): ConfigSelectOption[] | null {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) return null
  const options: ConfigSelectOption[] = []
  for (const value of schema.enum) {
    if (!matchesKind(value, kind)) return null
    options.push({ value, label: String(value) })
  }
  return options
}

function defaultValueFor(field: Omit<ConfigField, "default">, raw: unknown): ConfigPrimitive {
  if (field.kind === "select") {
    if (matchesKind(raw, "select") && field.options.some((option) => option.value === raw)) {
      return raw
    }
    return field.options[0]?.value ?? ""
  }
  if (matchesKind(raw, field.kind)) return raw
  switch (field.kind) {
    case "text":
      return ""
    case "number":
    case "integer":
      return 0
    case "boolean":
      return false
    default:
      return ""
  }
}

/**
 * Supported form fields in declaration order.
 *
 * Unknown kinds, nested objects/arrays and secret-marked fields are omitted
 * rather than rendered in a lossy or unsafe way.
 */
export function formFields(schema: PluginJsonSchema): ConfigField[] {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return []
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : [])
  const fields: ConfigField[] = []

  for (const [name, raw] of Object.entries(schema.properties)) {
    if (name.length === 0 || FORBIDDEN_FIELD_NAMES.has(name)) continue
    if (!isPlainObject(raw) || isSecretField(raw)) continue
    const kind = fieldKindOf(raw)
    if (!kind) continue

    const options =
      kind === "select" ? enumOptions(raw, kind) : null
    // A select without a valid primitive enum cannot be represented.
    if (kind === "select" && !options) continue

    const field = {
      name,
      kind,
      label: isString(raw.title) && raw.title.length > 0 ? raw.title : name,
      description: isString(raw.description) && raw.description.length > 0 ? raw.description : undefined,
      required: required.has(name),
      options: options ?? [],
      minimum: finiteNumber(raw.minimum) ? raw.minimum : undefined,
      maximum: finiteNumber(raw.maximum) ? raw.maximum : undefined,
      minLength: Number.isInteger(raw.minLength) ? (raw.minLength as number) : undefined,
      maxLength: Number.isInteger(raw.maxLength) ? (raw.maxLength as number) : undefined,
      pattern: isString(raw.pattern) ? raw.pattern : undefined,
    } satisfies Omit<ConfigField, "default">
    fields.push({ ...field, default: defaultValueFor(field, raw.default) })
  }

  return fields
}

/**
 * Loaded values projected onto the declared schema.
 *
 * Values with the wrong type, an out-of-enum select or an unknown key fall back
 * to the field default / are dropped.
 */
export function initialFormValues(
  schema: PluginJsonSchema,
  loaded: unknown,
): ConfigFormValues {
  const source = isPlainObject(loaded) ? loaded : {}
  const values: ConfigFormValues = {}
  for (const field of formFields(schema)) {
    const raw = Object.prototype.hasOwnProperty.call(source, field.name)
      ? source[field.name]
      : undefined
    if (field.kind === "select") {
      values[field.name] =
        matchesKind(raw, "select") && field.options.some((option) => option.value === raw)
          ? raw
          : field.default
      continue
    }
    values[field.name] = matchesKind(raw, field.kind) ? raw : field.default
  }
  return values
}

/** Validation diagnostics for one draft; empty means save may proceed. */
export function validateFormValues(schema: PluginJsonSchema, values: unknown): string[] {
  if (!isPlainObject(values)) return ["config values must be an object"]
  const fields = formFields(schema)
  const byName = new Map(fields.map((field) => [field.name, field]))
  const errors: string[] = []

  for (const name of Object.keys(values)) {
    if (!byName.has(name)) errors.push(`unknown config field "${name}"`)
  }

  for (const field of fields) {
    const value = values[field.name]
    if (value === undefined) {
      if (field.required) errors.push(`field "${field.name}" is required`)
      continue
    }
    if (!matchesKind(value, field.kind)) {
      const article = field.kind === "integer" ? "an" : "a"
      errors.push(`field "${field.name}" must be ${article} ${field.kind}`)
      continue
    }

    if (field.kind === "select") {
      if (!field.options.some((option) => option.value === value)) {
        errors.push(
          `field "${field.name}" must be one of: ${field.options.map((option) => String(option.value)).join(", ")}`,
        )
      }
      continue
    }

    if (field.kind === "text") {
      const text = value as string
      if (field.required && text.trim().length === 0) {
        errors.push(`field "${field.name}" is required`)
        continue
      }
      if (field.minLength !== undefined && text.length < field.minLength) {
        errors.push(`field "${field.name}" must be at least ${field.minLength} characters`)
      }
      if (field.maxLength !== undefined && text.length > field.maxLength) {
        errors.push(`field "${field.name}" must be at most ${field.maxLength} characters`)
      }
      if (field.pattern !== undefined) {
        try {
          if (!new RegExp(field.pattern).test(text)) {
            errors.push(`field "${field.name}" must match ${field.pattern}`)
          }
        } catch {
          // An invalid pattern is a schema defect, not a user error: ignore it.
        }
      }
      continue
    }

    if (field.kind === "number" || field.kind === "integer") {
      const numeric = value as number
      if (field.minimum !== undefined && numeric < field.minimum) {
        errors.push(`field "${field.name}" must be at least ${field.minimum}`)
      }
      if (field.maximum !== undefined && numeric > field.maximum) {
        errors.push(`field "${field.name}" must be at most ${field.maximum}`)
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Request controller
// ---------------------------------------------------------------------------

export type ConfigFormStatus = "idle" | "loading" | "ready" | "saving"

export interface ConfigControllerIdentity {
  revision: string
  pageId: string
}

export interface PluginConfigFormState {
  status: ConfigFormStatus
  values: ConfigFormValues
  /** Values of the last successful load/save; used to detect a dirty draft. */
  baseline: ConfigFormValues
  errors: string[]
  error: string | null
  stale: boolean
  revision: string
  pageId: string
  requestId: number
}

export const EMPTY_PLUGIN_CONFIG_FORM_STATE: PluginConfigFormState = Object.freeze({
  status: "idle",
  values: {},
  baseline: {},
  errors: [],
  error: null,
  stale: false,
  revision: "",
  pageId: "",
  requestId: 0,
})

export type ConfigSaveOutcome = "saved" | "invalid" | "failed" | "stale" | "busy"

export interface PluginConfigControllerDeps {
  schema: () => PluginJsonSchema
  identity: () => ConfigControllerIdentity
  load: () => Promise<unknown>
  save: (values: ConfigFormValues) => Promise<unknown>
  reload: () => Promise<unknown>
  reloadOnSave: () => boolean
  generation: () => PluginGeneration
  isGenerationCurrent: (generation: PluginGeneration) => boolean
  /** Neutral failure notification (used for toasts by the component). */
  onError?: (message: string) => void
}

export interface PluginConfigController {
  state: Accessor<PluginConfigFormState>
  load: () => Promise<void>
  reload: () => Promise<void>
  save: () => Promise<ConfigSaveOutcome>
  setValue: (name: string, value: ConfigPrimitive) => void
  /** Called by the identity effect when descriptor revision/page changes. */
  checkIdentity: (revision: string, pageId: string) => void
}

export interface PluginConfigControllerRuntime {
  createSignal<T>(value: T): [Accessor<T>, Setter<T>]
  untrack<T>(fn: () => T): T
}

const defaultRuntime: PluginConfigControllerRuntime = {
  createSignal: solidCreateSignal,
  untrack: solidUntrack,
}

function samePrimitive(a: ConfigPrimitive | undefined, b: ConfigPrimitive | undefined): boolean {
  return a === b
}

function sameValues(a: ConfigFormValues, b: ConfigFormValues): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && samePrimitive(a[key], b[key]))
}

export function configFormDirty(state: PluginConfigFormState): boolean {
  return !sameValues(state.values, state.baseline)
}

const STALE_DRAFT_MESSAGE = "插件已更新，当前草稿基于旧配置，请重新加载后再保存"
const STALE_LOAD_MESSAGE = "插件已更新，请重新加载配置"

/**
 * Save output may be the persisted values, an arbitrary result object or
 * undefined. Only known schema keys are merged over the submitted snapshot, so
 * `{ ok: true }` can never blank the form.
 */
function mergeSaveOutput(
  schema: PluginJsonSchema,
  submitted: ConfigFormValues,
  raw: unknown,
): ConfigFormValues {
  if (!isPlainObject(raw)) return { ...submitted }
  return initialFormValues(schema, { ...submitted, ...raw })
}

export function createPluginConfigController(
  deps: PluginConfigControllerDeps,
  runtime: PluginConfigControllerRuntime = defaultRuntime,
): PluginConfigController {
  const [state, setState] = runtime.createSignal<PluginConfigFormState>(EMPTY_PLUGIN_CONFIG_FORM_STATE)
  let requestSeq = 0
  let disposed = false

  const messageOf = (err: unknown): string => {
    if (err instanceof Error) return err.message
    return String(err)
  }

  const load = async (): Promise<void> => {
    if (disposed) return
    const requestId = ++requestSeq
    const generation = runtime.untrack(() => deps.generation())
    const identity = runtime.untrack(() => deps.identity())
    setState((current) => ({
      ...current,
      status: "loading",
      error: null,
      errors: [],
      requestId,
    }))
    try {
      const raw = await deps.load()
      if (disposed || requestId !== requestSeq) return
      const currentIdentity = deps.identity()
      if (
        !deps.isGenerationCurrent(generation) ||
        currentIdentity.revision !== identity.revision ||
        currentIdentity.pageId !== identity.pageId
      ) {
        // Do not apply an old schema's values. An identity change leaves the
        // form idle so the identity effect can issue a fresh load; a plugin
        // revision change under the same identity requires an explicit reload.
        const identityChanged =
          currentIdentity.revision !== identity.revision || currentIdentity.pageId !== identity.pageId
        if (identityChanged) {
          // Retry immediately for the current identity: the identity effect
          // already ran while the old request was in flight and will not run
          // again just because this response arrived.
          setState((current) => ({ ...current, status: "idle", requestId }))
          return load()
        }
        setState((current) => ({
          ...current,
          status: "ready",
          stale: true,
          error: STALE_LOAD_MESSAGE,
          requestId,
        }))
        return
      }
      const values = initialFormValues(deps.schema(), raw)
      setState((current) => ({
        ...current,
        status: "ready",
        values,
        baseline: { ...values },
        errors: [],
        error: null,
        stale: false,
        revision: identity.revision,
        pageId: identity.pageId,
        requestId,
      }))
    } catch (err) {
      if (disposed || requestId !== requestSeq) return
      const currentIdentity = deps.identity()
      const identityChanged =
        currentIdentity.revision !== identity.revision || currentIdentity.pageId !== identity.pageId
      if (identityChanged) {
        setState((current) => ({ ...current, status: "idle", requestId }))
        return load()
      }
      if (!deps.isGenerationCurrent(generation)) {
        setState((current) => ({
          ...current,
          status: "ready",
          stale: true,
          error: STALE_LOAD_MESSAGE,
          requestId,
        }))
        return
      }
      const message = `加载失败：${messageOf(err)}`
      setState((current) => ({
        ...current,
        status: "ready",
        errors: [],
        error: message,
        requestId,
      }))
    }
  }

  const save = async (): Promise<ConfigSaveOutcome> => {
    if (disposed) return "failed"
    const current = runtime.untrack(() => state())
    if (current.status === "loading" || current.status === "saving") return "busy"
    if (current.stale) {
      setState((value) => ({ ...value, error: STALE_DRAFT_MESSAGE }))
      return "stale"
    }

    const schema = runtime.untrack(() => deps.schema())
    const errors = validateFormValues(schema, current.values)
    if (errors.length > 0) {
      setState((value) => ({ ...value, errors, error: null }))
      return "invalid"
    }

    const requestId = ++requestSeq
    const generation = runtime.untrack(() => deps.generation())
    const identity = runtime.untrack(() => deps.identity())
    const submitted = { ...current.values }
    setState((value) => ({
      ...value,
      status: "saving",
      errors: [],
      error: null,
      requestId,
    }))

    try {
      const raw = await deps.save(submitted)
      if (disposed || requestId !== requestSeq) return "failed"
      const currentIdentity = deps.identity()
      if (
        !deps.isGenerationCurrent(generation) ||
        currentIdentity.revision !== identity.revision ||
        currentIdentity.pageId !== identity.pageId
      ) {
        // The package changed while saving: keep the draft, but never pretend
        // it was persisted under the new revision.
        setState((value) => ({
          ...value,
          status: "ready",
          stale: true,
          error: STALE_DRAFT_MESSAGE,
          requestId,
        }))
        return "stale"
      }

      const values = mergeSaveOutput(schema, submitted, raw)
      setState((value) => ({
        ...value,
        status: "ready",
        values,
        baseline: { ...values },
        errors: [],
        error: null,
        stale: false,
        revision: identity.revision,
        pageId: identity.pageId,
        requestId,
      }))

      if (runtime.untrack(() => deps.reloadOnSave())) {
        try {
          await deps.reload()
        } catch (err) {
          if (!disposed) {
            const message = `已保存，但重新加载失败：${messageOf(err)}`
            setState((value) => ({ ...value, error: message }))
            deps.onError?.(message)
          }
          return "saved"
        }
      }
      return "saved"
    } catch (err) {
      if (disposed || requestId !== requestSeq) return "failed"
      if (!deps.isGenerationCurrent(generation)) {
        setState((value) => ({
          ...value,
          status: "ready",
          stale: true,
          error: STALE_DRAFT_MESSAGE,
          requestId,
        }))
        return "stale"
      }
      const message = `保存失败：${messageOf(err)}`
      // Keep the draft and the previous baseline: the user can retry.
      setState((value) => ({ ...value, status: "ready", error: message, requestId }))
      deps.onError?.(message)
      return "failed"
    }
  }

  const setValue = (name: string, value: ConfigPrimitive): void => {
    setState((current) => {
      if (current.status === "saving") return current
      if (!formFields(deps.schema()).some((field) => field.name === name)) return current
      return {
        ...current,
        values: { ...current.values, [name]: value },
        errors: [],
      }
    })
  }

  const checkIdentity = (revision: string, pageId: string): void => {
    if (disposed) return
    const current = runtime.untrack(() => state())
    if (current.status === "idle") {
      void load()
      return
    }
    if (current.status === "loading" || current.status === "saving") return
    if (current.revision === revision && current.pageId === pageId) return

    if (configFormDirty(current)) {
      setState((value) => ({ ...value, stale: true, error: STALE_DRAFT_MESSAGE }))
      return
    }
    void load()
  }

  return {
    state,
    load,
    reload: load,
    save,
    setValue,
    checkIdentity,
  }
}
