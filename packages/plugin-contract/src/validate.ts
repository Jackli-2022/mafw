/**
 * Hand-written structural validation for plugin client descriptors, declarative
 * views and the restricted config form schema subset.
 *
 * Deliberately imports nothing from DOM, Electron, Node filesystem or gateway.
 * Every entry point fails closed and rejects over-limit input instead of
 * truncating it silently.
 */
import { PLUGIN_UI_LIMITS } from "./limits.ts"
import type {
  PluginActionDescriptor,
  PluginClientDescriptor,
  PluginConfigPageDescriptor,
  PluginDiagnostic,
  PluginEventDescriptor,
  PluginJsonSchema,
  PluginMessageWindowDescriptor,
  PluginPanelDescriptor,
  PluginToolCardDescriptor,
  PluginUiContribution,
  PluginView,
  Widget,
} from "./types.ts"

export type PluginDescriptorValidation =
  | { ok: true; value: PluginClientDescriptor }
  | { ok: false; error: string }

const MAX_ERRORS = 50

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const EVENT_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._+-]+)*,/i

const MAX_ID_LENGTH = 128
const MAX_TITLE_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 2048
const MAX_VERSION_LENGTH = 64
const MAX_REVISION_LENGTH = 256
const MAX_DIAGNOSTICS = 100

const DESCRIPTOR_KEYS = [
  "name",
  "version",
  "revision",
  "title",
  "description",
  "ui",
  "actions",
  "events",
  "diagnostics",
] as const

const UI_SLOT_KEYS = ["panels", "toolCards", "configPages", "messageWindows"] as const

const PANEL_KEYS = ["id", "title", "icon", "order", "viewAction", "refreshOn"] as const
const TOOL_CARD_KEYS = ["id", "tools", "override", "viewAction"] as const
const CONFIG_PAGE_KEYS = ["id", "title", "schema", "loadAction", "saveAction", "reloadOnSave"] as const
const MESSAGE_WINDOW_KEYS = ["id", "title", "triggerEvent", "viewAction", "modal", "dismissible"] as const

const ACTION_KEYS = ["name", "title", "description", "inputSchema", "outputSchema", "timeoutMs"] as const
const EVENT_KEYS = ["type", "title", "description", "schema", "scope"] as const
const DIAGNOSTIC_KEYS = ["level", "message", "code"] as const

const CONFIG_ROOT_KEYS = ["type", "title", "description", "properties", "required", "additionalProperties"] as const
const CONFIG_FIELD_KEYS = [
  "type",
  "title",
  "description",
  "default",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "multipleOf",
  "examples",
] as const
const CONFIG_FIELD_KINDS = ["string", "number", "integer", "boolean"] as const

const FORBIDDEN_FIELD_NAMES = ["__proto__", "prototype", "constructor"]

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** UTF-8 byte length without depending on Node or DOM globals. */
function utf8Length(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    return typeof json === "string" ? json : String(value)
  } catch {
    return String(value)
  }
}

function jsonByteLength(value: unknown): number | null {
  if (value === undefined) return 0
  try {
    const json = JSON.stringify(value)
    return typeof json === "string" ? utf8Length(json) : null
  } catch {
    return null
  }
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function addError(errors: string[], message: string): void {
  if (errors.length >= MAX_ERRORS) return
  errors.push(message)
}

function formatErrors(errors: string[]): string {
  const shown = errors.slice(0, MAX_ERRORS)
  const remaining = errors.length - shown.length
  return remaining > 0 ? `${shown.join("; ")} (+${remaining} more)` : shown.join("; ")
}

function requireString(
  value: unknown,
  label: string,
  maxLength: number,
  errors: string[],
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, `${label} must be a non-empty string`)
    return undefined
  }
  if (value.length > maxLength) {
    addError(errors, `${label} exceeds ${maxLength} characters`)
    return undefined
  }
  return value
}

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
  errors: string[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    addError(errors, `${label} must be a string`)
    return undefined
  }
  if (value.length > maxLength) {
    addError(errors, `${label} exceeds ${maxLength} characters`)
    return undefined
  }
  return value
}

function readIdentifier(value: unknown, label: string, errors: string[]): string | undefined {
  const id = requireString(value, label, MAX_ID_LENGTH, errors)
  if (id === undefined) return undefined
  if (!NAME_PATTERN.test(id)) {
    addError(errors, `${label} "${id}" must not contain ":" or whitespace`)
    return undefined
  }
  return id
}

function optionalNumber(value: unknown, label: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addError(errors, `${label} must be a finite number`)
    return undefined
  }
  return value
}

function optionalBoolean(value: unknown, label: string, errors: string[]): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") {
    addError(errors, `${label} must be a boolean`)
    return undefined
  }
  return value
}

function checkKnownFields(
  value: PlainObject,
  allowed: readonly string[],
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) addError(errors, `${label} has unknown field "${key}"`)
  }
}

function readJsonSchemaObject(
  value: unknown,
  label: string,
  errors: string[],
): PluginJsonSchema | undefined {
  if (!isPlainObject(value)) {
    addError(errors, `${label} must be an object`)
    return undefined
  }
  const size = jsonByteLength(value)
  if (size === null) {
    addError(errors, `${label} must be JSON-serializable`)
    return undefined
  }
  if (size > PLUGIN_UI_LIMITS.maxActionPayloadBytes) {
    addError(errors, `${label} exceeds ${PLUGIN_UI_LIMITS.maxActionPayloadBytes} bytes`)
    return undefined
  }
  return cloneJson(value) as PluginJsonSchema
}

function readActionRef(
  value: unknown,
  label: string,
  actionNames: Set<string>,
  errors: string[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    addError(errors, `${label} must be a non-empty action name`)
    return undefined
  }
  if (value.includes(":")) {
    addError(errors, `${label} cross-package action reference "${value}"`)
    return undefined
  }
  if (!actionNames.has(value)) {
    addError(errors, `${label} unknown action reference "${value}"`)
    return undefined
  }
  return value
}

function readEventRef(
  value: unknown,
  label: string,
  prefix: string,
  eventTypes: Set<string>,
  errors: string[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    addError(errors, `${label} must be a non-empty event type`)
    return undefined
  }
  if (!value.startsWith(prefix)) {
    if (value.startsWith("plugin:")) {
      addError(errors, `${label} cross-package event reference "${value}"`)
    } else {
      addError(errors, `${label} unknown event reference "${value}" (expected ${prefix}*)`)
    }
    return undefined
  }
  if (!eventTypes.has(value)) {
    addError(errors, `${label} unknown event reference "${value}"`)
    return undefined
  }
  return value
}

function readEventRefList(
  value: unknown,
  label: string,
  prefix: string,
  eventTypes: Set<string>,
  errors: string[],
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    addError(errors, `${label} must be an array of event types`)
    return undefined
  }
  const out: string[] = []
  for (const item of value) {
    const ref = readEventRef(item, label, prefix, eventTypes, errors)
    if (ref !== undefined) out.push(ref)
  }
  return out
}

function readActions(value: unknown, errors: string[]): PluginActionDescriptor[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addError(errors, "actions must be an array")
    return []
  }
  const actions: PluginActionDescriptor[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const label = `actions[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, ACTION_KEYS, label, errors)
    const name = requireString(item.name, `${label}.name`, MAX_ID_LENGTH, errors)
    if (name === undefined) return
    if (!NAME_PATTERN.test(name)) {
      addError(errors, `${label}.name "${name}" must not contain ":" or whitespace`)
      return
    }
    if (seen.has(name)) {
      addError(errors, `duplicate action name "${name}"`)
      return
    }
    seen.add(name)

    const action: PluginActionDescriptor = { name }
    const title = optionalString(item.title, `action "${name}" title`, MAX_TITLE_LENGTH, errors)
    if (title !== undefined) action.title = title
    const description = optionalString(
      item.description,
      `action "${name}" description`,
      MAX_DESCRIPTION_LENGTH,
      errors,
    )
    if (description !== undefined) action.description = description

    const inputSchema =
      item.inputSchema === undefined
        ? undefined
        : readJsonSchemaObject(item.inputSchema, `action "${name}" inputSchema`, errors)
    if (inputSchema !== undefined) action.inputSchema = inputSchema
    const outputSchema =
      item.outputSchema === undefined
        ? undefined
        : readJsonSchemaObject(item.outputSchema, `action "${name}" outputSchema`, errors)
    if (outputSchema !== undefined) action.outputSchema = outputSchema

    if (item.timeoutMs !== undefined) {
      const timeout = item.timeoutMs
      if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0) {
        addError(errors, `action "${name}" timeoutMs must be a positive integer`)
      } else if (timeout > PLUGIN_UI_LIMITS.maxActionTimeoutMs) {
        addError(
          errors,
          `action "${name}" timeoutMs exceeds the maximum of ${PLUGIN_UI_LIMITS.maxActionTimeoutMs}ms`,
        )
      } else {
        action.timeoutMs = timeout
      }
    }

    actions.push(action)
  })
  return actions
}

function readEvents(value: unknown, packageName: string, errors: string[]): PluginEventDescriptor[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addError(errors, "events must be an array")
    return []
  }
  const prefix = `plugin:${packageName}:`
  const events: PluginEventDescriptor[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const label = `events[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, EVENT_KEYS, label, errors)
    const type = requireString(item.type, `${label}.type`, MAX_ID_LENGTH, errors)
    if (type === undefined) return
    if (!type.startsWith(prefix)) {
      addError(errors, `event type "${type}" must use the plugin:<package>:<event> namespace (expected prefix "${prefix}")`)
      return
    }
    const segment = type.slice(prefix.length)
    if (!EVENT_SEGMENT_PATTERN.test(segment)) {
      addError(errors, `event type "${type}" must end with a non-empty event name`)
      return
    }
    if (seen.has(type)) {
      addError(errors, `duplicate event type "${type}"`)
      return
    }
    seen.add(type)

    const event: PluginEventDescriptor = { type }
    const title = optionalString(item.title, `event "${type}" title`, MAX_TITLE_LENGTH, errors)
    if (title !== undefined) event.title = title
    const description = optionalString(
      item.description,
      `event "${type}" description`,
      MAX_DESCRIPTION_LENGTH,
      errors,
    )
    if (description !== undefined) event.description = description
    const schema =
      item.schema === undefined
        ? undefined
        : readJsonSchemaObject(item.schema, `event "${type}" schema`, errors)
    if (schema !== undefined) event.schema = schema
    if (item.scope !== undefined) {
      if (item.scope === "global" || item.scope === "session") {
        event.scope = item.scope
      } else {
        addError(errors, `event "${type}" scope must be "global" or "session"`)
      }
    }
    events.push(event)
  })
  return events
}

function readPanels(
  value: unknown,
  actionNames: Set<string>,
  prefix: string,
  eventTypes: Set<string>,
  errors: string[],
): PluginPanelDescriptor[] | undefined {
  if (!Array.isArray(value)) {
    addError(errors, "ui.panels must be an array")
    return undefined
  }
  if (value.length > PLUGIN_UI_LIMITS.maxWidgets) {
    addError(errors, `ui.panels exceeds ${PLUGIN_UI_LIMITS.maxWidgets} entries`)
    return undefined
  }
  const panels: PluginPanelDescriptor[] = []
  const ids = new Set<string>()
  value.forEach((item, index) => {
    const label = `panels[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, PANEL_KEYS, label, errors)
    const id = readIdentifier(item.id, `${label}.id`, errors)
    if (id === undefined) return
    if (ids.has(id)) {
      addError(errors, `duplicate panel id "${id}"`)
      return
    }
    ids.add(id)

    const panelLabel = `panel "${id}"`
    const title = requireString(item.title, `${panelLabel} title`, MAX_TITLE_LENGTH, errors)
    const viewAction = readActionRef(item.viewAction, `${panelLabel} viewAction`, actionNames, errors)
    const refreshOn = readEventRefList(
      item.refreshOn,
      `${panelLabel} refreshOn`,
      prefix,
      eventTypes,
      errors,
    )

    const panel: PluginPanelDescriptor = {
      id,
      title: title ?? "",
      viewAction: viewAction ?? "",
    }
    const icon = optionalString(item.icon, `${panelLabel} icon`, MAX_ID_LENGTH, errors)
    if (icon !== undefined) panel.icon = icon
    const order = optionalNumber(item.order, `${panelLabel} order`, errors)
    if (order !== undefined) panel.order = order
    if (refreshOn !== undefined) panel.refreshOn = refreshOn
    panels.push(panel)
  })
  return panels
}

function readToolCards(
  value: unknown,
  actionNames: Set<string>,
  errors: string[],
): PluginToolCardDescriptor[] | undefined {
  if (!Array.isArray(value)) {
    addError(errors, "ui.toolCards must be an array")
    return undefined
  }
  if (value.length > PLUGIN_UI_LIMITS.maxWidgets) {
    addError(errors, `ui.toolCards exceeds ${PLUGIN_UI_LIMITS.maxWidgets} entries`)
    return undefined
  }
  const cards: PluginToolCardDescriptor[] = []
  const ids = new Set<string>()
  value.forEach((item, index) => {
    const label = `toolCards[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, TOOL_CARD_KEYS, label, errors)
    const id = readIdentifier(item.id, `${label}.id`, errors)
    if (id === undefined) return
    if (ids.has(id)) {
      addError(errors, `duplicate tool card id "${id}"`)
      return
    }
    ids.add(id)

    const cardLabel = `tool card "${id}"`
    const tools: string[] = []
    if (!Array.isArray(item.tools) || item.tools.length === 0) {
      addError(errors, `${cardLabel} tools must be a non-empty array of tool names`)
    } else {
      for (const tool of item.tools) {
        const name = requireString(tool, `${cardLabel} tool name`, MAX_ID_LENGTH, errors)
        if (name !== undefined) tools.push(name)
      }
    }
    const viewAction = readActionRef(item.viewAction, `${cardLabel} viewAction`, actionNames, errors)
    const override = optionalBoolean(item.override, `${cardLabel} override`, errors)

    const card: PluginToolCardDescriptor = {
      id,
      tools,
      viewAction: viewAction ?? "",
    }
    if (override !== undefined) card.override = override
    cards.push(card)
  })
  return cards
}

function readConfigPages(
  value: unknown,
  actionNames: Set<string>,
  errors: string[],
): PluginConfigPageDescriptor[] | undefined {
  if (!Array.isArray(value)) {
    addError(errors, "ui.configPages must be an array")
    return undefined
  }
  if (value.length > PLUGIN_UI_LIMITS.maxWidgets) {
    addError(errors, `ui.configPages exceeds ${PLUGIN_UI_LIMITS.maxWidgets} entries`)
    return undefined
  }
  const pages: PluginConfigPageDescriptor[] = []
  const ids = new Set<string>()
  value.forEach((item, index) => {
    const label = `configPages[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, CONFIG_PAGE_KEYS, label, errors)
    const id = readIdentifier(item.id, `${label}.id`, errors)
    if (id === undefined) return
    if (ids.has(id)) {
      addError(errors, `duplicate config page id "${id}"`)
      return
    }
    ids.add(id)

    const pageLabel = `config page "${id}"`
    const title = requireString(item.title, `${pageLabel} title`, MAX_TITLE_LENGTH, errors)
    const loadAction = readActionRef(item.loadAction, `${pageLabel} loadAction`, actionNames, errors)
    const saveAction = readActionRef(item.saveAction, `${pageLabel} saveAction`, actionNames, errors)
    const reloadOnSave = optionalBoolean(item.reloadOnSave, `${pageLabel} reloadOnSave`, errors)

    let pageSchema: PluginJsonSchema = { type: "object", properties: {} }
    if (item.schema === undefined) {
      addError(errors, `${pageLabel} schema must be an object`)
    } else if (isPlainObject(item.schema)) {
      const schemaSize = jsonByteLength(item.schema)
      if (schemaSize === null) {
        addError(errors, `${pageLabel} schema must be JSON-serializable`)
      } else if (schemaSize > PLUGIN_UI_LIMITS.maxActionPayloadBytes) {
        addError(errors, `${pageLabel} schema exceeds ${PLUGIN_UI_LIMITS.maxActionPayloadBytes} bytes`)
      } else {
        try {
          pageSchema = cloneJson(item.schema) as PluginJsonSchema
        } catch {
          addError(errors, `${pageLabel} schema must be JSON-serializable`)
        }
        for (const schemaError of validateConfigFormSchema(item.schema as PluginJsonSchema)) {
          addError(errors, `${pageLabel}: ${schemaError}`)
        }
      }
    } else {
      for (const schemaError of validateConfigFormSchema(item.schema as PluginJsonSchema)) {
        addError(errors, `${pageLabel}: ${schemaError}`)
      }
    }

    const page: PluginConfigPageDescriptor = {
      id,
      title: title ?? "",
      schema: pageSchema,
      loadAction: loadAction ?? "",
      saveAction: saveAction ?? "",
    }
    if (reloadOnSave !== undefined) page.reloadOnSave = reloadOnSave
    pages.push(page)
  })
  return pages
}

function readMessageWindows(
  value: unknown,
  actionNames: Set<string>,
  prefix: string,
  eventTypes: Set<string>,
  errors: string[],
): PluginMessageWindowDescriptor[] | undefined {
  if (!Array.isArray(value)) {
    addError(errors, "ui.messageWindows must be an array")
    return undefined
  }
  if (value.length > PLUGIN_UI_LIMITS.maxWidgets) {
    addError(errors, `ui.messageWindows exceeds ${PLUGIN_UI_LIMITS.maxWidgets} entries`)
    return undefined
  }
  const windows: PluginMessageWindowDescriptor[] = []
  const ids = new Set<string>()
  value.forEach((item, index) => {
    const label = `messageWindows[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, MESSAGE_WINDOW_KEYS, label, errors)
    const id = readIdentifier(item.id, `${label}.id`, errors)
    if (id === undefined) return
    if (ids.has(id)) {
      addError(errors, `duplicate message window id "${id}"`)
      return
    }
    ids.add(id)

    const windowLabel = `message window "${id}"`
    const title = requireString(item.title, `${windowLabel} title`, MAX_TITLE_LENGTH, errors)
    const triggerEvent = readEventRef(
      item.triggerEvent,
      `${windowLabel} triggerEvent`,
      prefix,
      eventTypes,
      errors,
    )
    const viewAction = readActionRef(item.viewAction, `${windowLabel} viewAction`, actionNames, errors)
    const modal = optionalBoolean(item.modal, `${windowLabel} modal`, errors)
    const dismissible = optionalBoolean(item.dismissible, `${windowLabel} dismissible`, errors)

    const messageWindow: PluginMessageWindowDescriptor = {
      id,
      title: title ?? "",
      triggerEvent: triggerEvent ?? "",
      viewAction: viewAction ?? "",
    }
    if (modal !== undefined) messageWindow.modal = modal
    if (dismissible !== undefined) messageWindow.dismissible = dismissible
    windows.push(messageWindow)
  })
  return windows
}

function readUi(
  value: unknown,
  packageName: string,
  actionNames: Set<string>,
  eventTypes: Set<string>,
  errors: string[],
): PluginUiContribution {
  if (!isPlainObject(value)) {
    addError(errors, "ui must be an object")
    return {}
  }
  for (const key of Object.keys(value)) {
    if (!(UI_SLOT_KEYS as readonly string[]).includes(key)) {
      addError(errors, `"ui" has unknown ui slot "${key}"`)
    }
  }

  const prefix = `plugin:${packageName}:`
  const ui: PluginUiContribution = {}
  if (value.panels !== undefined) {
    const panels = readPanels(value.panels, actionNames, prefix, eventTypes, errors)
    if (panels !== undefined) ui.panels = panels
  }
  if (value.toolCards !== undefined) {
    const toolCards = readToolCards(value.toolCards, actionNames, errors)
    if (toolCards !== undefined) ui.toolCards = toolCards
  }
  if (value.configPages !== undefined) {
    const configPages = readConfigPages(value.configPages, actionNames, errors)
    if (configPages !== undefined) ui.configPages = configPages
  }
  if (value.messageWindows !== undefined) {
    const messageWindows = readMessageWindows(
      value.messageWindows,
      actionNames,
      prefix,
      eventTypes,
      errors,
    )
    if (messageWindows !== undefined) ui.messageWindows = messageWindows
  }
  return ui
}

function readDiagnostics(value: unknown, errors: string[]): PluginDiagnostic[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    addError(errors, "diagnostics must be an array")
    return undefined
  }
  if (value.length > MAX_DIAGNOSTICS) {
    addError(errors, `diagnostics exceeds ${MAX_DIAGNOSTICS} entries`)
    return undefined
  }
  const diagnostics: PluginDiagnostic[] = []
  value.forEach((item, index) => {
    const label = `diagnostics[${index}]`
    if (!isPlainObject(item)) {
      addError(errors, `${label} must be an object`)
      return
    }
    checkKnownFields(item, DIAGNOSTIC_KEYS, label, errors)
    if (item.level !== "error" && item.level !== "warning" && item.level !== "info") {
      addError(errors, `${label}.level must be error, warning or info`)
      return
    }
    const message = requireString(item.message, `${label}.message`, MAX_DESCRIPTION_LENGTH, errors)
    if (message === undefined) return
    const diagnostic: PluginDiagnostic = { level: item.level, message }
    const code = optionalString(item.code, `${label}.code`, MAX_ID_LENGTH, errors)
    if (code !== undefined) diagnostic.code = code
    diagnostics.push(diagnostic)
  })
  return diagnostics
}

/**
 * Validates and sanitizes a plugin client descriptor.
 *
 * Returns a deep, serializable copy containing only known fields; unknown
 * top-level fields and UI slots fail the whole descriptor so Host code can
 * never leak to Desktop through an ad-hoc property.
 */
export function validateClientDescriptor(value: unknown): PluginDescriptorValidation {
  const errors: string[] = []
  if (!isPlainObject(value)) {
    return { ok: false, error: "plugin descriptor must be an object" }
  }

  for (const key of Object.keys(value)) {
    if (!(DESCRIPTOR_KEYS as readonly string[]).includes(key)) {
      addError(errors, `unknown descriptor field "${key}"`)
    }
  }

  const name = requireString(value.name, "name", MAX_ID_LENGTH, errors)
  if (name !== undefined && !NAME_PATTERN.test(name)) {
    addError(errors, `name "${name}" must not contain ":" or whitespace`)
  }
  const version = requireString(value.version, "version", MAX_VERSION_LENGTH, errors)
  const revision = requireString(value.revision, "revision", MAX_REVISION_LENGTH, errors)
  const title = optionalString(value.title, "title", MAX_TITLE_LENGTH, errors)
  const description = optionalString(value.description, "description", MAX_DESCRIPTION_LENGTH, errors)

  const actions = readActions(value.actions, errors)
  const actionNames = new Set(actions.map((action) => action.name))
  const events = readEvents(value.events, name ?? "", errors)
  const eventTypes = new Set(events.map((event) => event.type))
  const ui = readUi(value.ui, name ?? "", actionNames, eventTypes, errors)
  const diagnostics = readDiagnostics(value.diagnostics, errors)

  if (errors.length > 0) {
    return { ok: false, error: formatErrors(errors) }
  }

  const descriptor: PluginClientDescriptor = {
    name: name as string,
    version: version as string,
    revision: revision as string,
    ui,
    actions,
    events,
  }
  if (title !== undefined) descriptor.title = title
  if (description !== undefined) descriptor.description = description
  if (diagnostics !== undefined) descriptor.diagnostics = diagnostics
  return { ok: true, value: descriptor }
}

interface NormalizeState {
  count: number
}

function normalizeText(value: unknown): string | null {
  const text = typeof value === "string" ? value : safeStringify(value)
  return utf8Length(text) <= PLUGIN_UI_LIMITS.maxTextBytes ? text : null
}

function normalizeWidget(raw: unknown, depth: number, state: NormalizeState): Widget | null {
  if (depth > PLUGIN_UI_LIMITS.maxDepth) return null
  state.count += 1
  if (state.count > PLUGIN_UI_LIMITS.maxWidgets) return null

  if (!isPlainObject(raw)) {
    const text = normalizeText(raw)
    return text === null ? null : { type: "text", text }
  }

  switch (raw.type) {
    case "text": {
      const text = normalizeText(raw.text)
      return text === null ? null : { type: "text", text }
    }
    case "code": {
      const text = normalizeText(raw.text)
      if (text === null) return null
      const code: Extract<Widget, { type: "code" }> = { type: "code", text }
      if (typeof raw.language === "string" && raw.language.length <= MAX_ID_LENGTH) {
        code.language = raw.language
      }
      return code
    }
    case "kv": {
      const rows: Array<[string, string]> = []
      if (Array.isArray(raw.rows)) {
        for (const row of raw.rows) {
          if (!Array.isArray(row) || row.length < 2) continue
          const key = normalizeText(row[0])
          const value = normalizeText(row[1])
          if (key === null || value === null) return null
          rows.push([key, value])
        }
      }
      return { type: "kv", rows }
    }
    case "tags": {
      const items: string[] = []
      if (Array.isArray(raw.items)) {
        for (const item of raw.items) {
          const text = normalizeText(item)
          if (text === null) return null
          items.push(text)
        }
      }
      return { type: "tags", items }
    }
    case "list": {
      const items: Array<string | Widget> = []
      if (Array.isArray(raw.items)) {
        for (const item of raw.items) {
          if (typeof item === "string") {
            const text = normalizeText(item)
            if (text === null) return null
            items.push(text)
            continue
          }
          const widget = normalizeWidget(item, depth + 1, state)
          if (widget === null) return null
          items.push(widget)
        }
      }
      return { type: "list", items }
    }
    case "row": {
      const children: Widget[] = []
      if (Array.isArray(raw.children)) {
        for (const child of raw.children) {
          const widget = normalizeWidget(child, depth + 1, state)
          if (widget === null) return null
          children.push(widget)
        }
      }
      return { type: "row", children }
    }
    case "image": {
      if (typeof raw.dataUrl !== "string" || !IMAGE_DATA_URL_PATTERN.test(raw.dataUrl)) return null
      if (utf8Length(raw.dataUrl) > PLUGIN_UI_LIMITS.maxImageDataUrlBytes) return null
      const image: Extract<Widget, { type: "image" }> = { type: "image", dataUrl: raw.dataUrl }
      if (raw.alt !== undefined) {
        if (typeof raw.alt !== "string") return null
        if (utf8Length(raw.alt) > PLUGIN_UI_LIMITS.maxTextBytes) return null
        image.alt = raw.alt
      }
      return image
    }
    case "link": {
      if (typeof raw.text !== "string" || typeof raw.href !== "string" || raw.href.length === 0) {
        return null
      }
      if (
        utf8Length(raw.text) > PLUGIN_UI_LIMITS.maxTextBytes ||
        utf8Length(raw.href) > PLUGIN_UI_LIMITS.maxTextBytes
      ) {
        return null
      }
      return { type: "link", text: raw.text, href: raw.href }
    }
    case "markdown": {
      const text = normalizeText(raw.text)
      return text === null ? null : { type: "markdown", text }
    }
    case "progress": {
      const rawValue = typeof raw.value === "number" ? raw.value : Number(raw.value)
      const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(100, rawValue)) : 0
      const progress: Extract<Widget, { type: "progress" }> = { type: "progress", value }
      if (raw.label !== undefined) {
        const label = normalizeText(raw.label)
        if (label === null) return null
        progress.label = label
      }
      return progress
    }
    case "action": {
      if (typeof raw.label !== "string" || typeof raw.action !== "string" || !NAME_PATTERN.test(raw.action)) {
        return null
      }
      const label = normalizeText(raw.label)
      if (label === null || label.length === 0) return null
      const action: Extract<Widget, { type: "action" }> = {
        type: "action",
        label,
        action: raw.action,
      }
      if (raw.style !== undefined) {
        if (raw.style !== "default" && raw.style !== "primary" && raw.style !== "danger") return null
        action.style = raw.style
      }
      if (raw.input !== undefined) {
        const size = jsonByteLength(raw.input)
        if (size === null || size > PLUGIN_UI_LIMITS.maxActionPayloadBytes) return null
        action.input = cloneJson(raw.input)
      }
      return action
    }
    default: {
      // Unknown widgets degrade to text so a newer package cannot break an
      // older Desktop, but they never become executable markup.
      const text = normalizeText(raw)
      return text === null ? null : { type: "text", text }
    }
  }
}

/**
 * Validates and sanitizes a declarative view.
 *
 * Returns `null` for malformed or over-limit input (depth, node count, text
 * bytes, image sources/size, action payload) instead of truncating. Unknown
 * widget types are downgraded to text.
 */
export function normalizePluginView(value: unknown): PluginView | null {
  if (!isPlainObject(value)) return null
  if (!Array.isArray(value.body)) return null

  const state: NormalizeState = { count: 0 }
  const body: Widget[] = []
  for (const raw of value.body) {
    const widget = normalizeWidget(raw, 1, state)
    if (widget === null) return null
    body.push(widget)
  }

  const view: PluginView = { body }
  if (value.title !== undefined) {
    const title = normalizeText(value.title)
    if (title === null) return null
    view.title = title
  }
  if (value.subtitle !== undefined) {
    const subtitle = normalizeText(value.subtitle)
    if (subtitle === null) return null
    view.subtitle = subtitle
  }
  if (value.icon !== undefined) {
    if (typeof value.icon !== "string" || value.icon.length > MAX_ID_LENGTH) return null
    view.icon = value.icon
  }
  return view
}

function matchesPrimitive(value: unknown, kind: string): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    default:
      return false
  }
}

function validateConfigField(name: string, value: unknown, errors: string[]): void {
  if (name.length === 0 || name.length > MAX_ID_LENGTH) {
    addError(errors, `config field name "${name}" must be between 1 and ${MAX_ID_LENGTH} characters`)
  }
  if (FORBIDDEN_FIELD_NAMES.includes(name)) {
    addError(errors, `config field name "${name}" is not allowed`)
  }
  if (!isPlainObject(value)) {
    addError(errors, `config field "${name}" must be an object`)
    return
  }
  for (const key of Object.keys(value)) {
    if (!(CONFIG_FIELD_KEYS as readonly string[]).includes(key)) {
      addError(errors, `config field "${name}" uses unsupported config field keyword "${key}"`)
    }
  }

  const kind = value.type
  if (kind === undefined) {
    addError(errors, `config field "${name}" is missing a type`)
    return
  }
  if (typeof kind !== "string" || !(CONFIG_FIELD_KINDS as readonly string[]).includes(kind)) {
    addError(errors, `config field "${name}" uses unsupported config field kind "${String(kind)}"`)
    return
  }

  optionalString(value.title, `config field "${name}" title`, MAX_TITLE_LENGTH, errors)
  optionalString(value.description, `config field "${name}" description`, MAX_DESCRIPTION_LENGTH, errors)

  if (value.default !== undefined && !matchesPrimitive(value.default, kind)) {
    addError(errors, `config field "${name}" default must be a ${kind}`)
  }
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0) {
      addError(errors, `config field "${name}" enum must be a non-empty array`)
    } else {
      for (const option of value.enum) {
        if (!matchesPrimitive(option, kind)) {
          addError(errors, `config field "${name}" enum values must be ${kind}`)
          break
        }
      }
    }
  }

  if (kind === "number" || kind === "integer") {
    for (const key of ["minimum", "maximum", "multipleOf"] as const) {
      const raw = value[key]
      if (raw === undefined) continue
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        addError(errors, `config field "${name}" ${key} must be a finite number`)
      }
    }
    if (
      typeof value.minimum === "number" &&
      typeof value.maximum === "number" &&
      value.minimum > value.maximum
    ) {
      addError(errors, `config field "${name}" minimum must not exceed maximum`)
    }
  } else if (kind === "string") {
    for (const key of ["minLength", "maxLength"] as const) {
      const raw = value[key]
      if (raw === undefined) continue
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        addError(errors, `config field "${name}" ${key} must be a non-negative integer`)
      }
    }
    if (
      typeof value.minLength === "number" &&
      typeof value.maxLength === "number" &&
      value.minLength > value.maxLength
    ) {
      addError(errors, `config field "${name}" minLength must not exceed maxLength`)
    }
    if (value.pattern !== undefined) {
      if (typeof value.pattern !== "string") {
        addError(errors, `config field "${name}" pattern must be a string`)
      } else {
        try {
          new RegExp(value.pattern)
        } catch {
          addError(errors, `config field "${name}" pattern must be a valid regular expression`)
        }
      }
    }
  }

  if (value.examples !== undefined && !Array.isArray(value.examples)) {
    addError(errors, `config field "${name}" examples must be an array`)
  }
}

/**
 * Validates the restricted form schema subset used by config pages:
 * an object whose properties are string/number/integer/boolean fields (with
 * optional enum for select inputs). Nested objects/arrays, remote refs and
 * secret formats are not representable.
 */
export function validateConfigFormSchema(value: PluginJsonSchema): string[] {
  const errors: string[] = []
  const schema = value as unknown
  if (!isPlainObject(schema)) {
    addError(errors, "config schema must be an object")
    return errors
  }

  for (const key of Object.keys(schema)) {
    if (!(CONFIG_ROOT_KEYS as readonly string[]).includes(key)) {
      addError(errors, `config schema uses unsupported keyword "${key}"`)
    }
  }
  if (schema.type !== "object") {
    addError(errors, 'config schema type must be "object"')
  }
  optionalString(schema.title, "config schema title", MAX_TITLE_LENGTH, errors)
  optionalString(schema.description, "config schema description", MAX_DESCRIPTION_LENGTH, errors)

  const properties = schema.properties
  if (!isPlainObject(properties)) {
    addError(errors, "config schema properties must be an object")
  } else {
    for (const [name, field] of Object.entries(properties)) {
      validateConfigField(name, field, errors)
    }
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string")) {
      addError(errors, "config schema required must be an array of field names")
    } else {
      const declared = isPlainObject(properties) ? new Set(Object.keys(properties)) : new Set<string>()
      for (const name of schema.required) {
        if (typeof name === "string" && !declared.has(name)) {
          addError(errors, `config schema required references undeclared field "${name}"`)
        }
      }
    }
  }

  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    addError(errors, "config schema additionalProperties must be a boolean")
  }

  return errors
}
