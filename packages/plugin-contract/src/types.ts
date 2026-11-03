/**
 * Shared DTOs for unified MAFW plugin packages.
 *
 * This module is intentionally free of DOM, Electron, Node filesystem and
 * gateway imports. It contains serializable data shapes only: the Desktop
 * never receives plugin Host code.
 */

/** Restricted JSON Schema subset accepted for plugin config form pages. */
export interface PluginJsonSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, PluginJsonSchema>
  required?: string[]
  items?: PluginJsonSchema
  additionalProperties?: boolean | PluginJsonSchema
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  [key: string]: unknown
}

/**
 * Declarative widget vocabulary rendered by Desktop.
 *
 * Widgets are plain data: no functions, expressions, event handlers, arbitrary
 * HTML/CSS/JS. Unknown widget types are downgraded to text by the normalizer.
 */
export type Widget =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "kv"; rows: Array<[string, string]> }
  | { type: "tags"; items: string[] }
  | { type: "list"; items: Array<string | Widget> }
  | { type: "row"; children: Widget[] }
  | { type: "image"; dataUrl: string; alt?: string }
  | { type: "link"; text: string; href: string }
  | { type: "markdown"; text: string }
  | { type: "progress"; value: number; label?: string }
  | {
      type: "action"
      /** Visible button label. */
      label: string
      /** Package-local action name invoked through the gateway. */
      action: string
      /** Static JSON input, validated against the action input schema. */
      input?: unknown
      style?: "default" | "primary" | "danger"
    }

/** One declarative view returned by a package `viewAction`. */
export interface PluginView {
  title?: string
  subtitle?: string
  icon?: string
  body: Widget[]
}

/** Right-workbench L2 tab contributed by a package. */
export interface PluginPanelDescriptor {
  id: string
  title: string
  icon?: string
  order?: number
  viewAction: string
  /** Registered package event types that trigger a view refresh. */
  refreshOn?: string[]
}

/** Declarative tool card that may replace or augment the default card. */
export interface PluginToolCardDescriptor {
  id: string
  /** Logical tool names; Desktop resolves aliases and canonical names. */
  tools: string[]
  /** Only `true` may replace a built-in or legacy card. */
  override?: boolean
  viewAction: string
}

/** Config page rendered from the restricted form schema subset. */
export interface PluginConfigPageDescriptor {
  id: string
  title: string
  schema: PluginJsonSchema
  loadAction: string
  saveAction: string
  reloadOnSave?: boolean
}

/** In-window message window triggered by a registered package event. */
export interface PluginMessageWindowDescriptor {
  id: string
  title: string
  triggerEvent: string
  viewAction: string
  modal?: boolean
  /** Defaults to `true`; when enabled the window can be closed with Esc. */
  dismissible?: boolean
}

/** First-phase UI contribution slots. Unknown slots are rejected. */
export interface PluginUiContribution {
  panels?: PluginPanelDescriptor[]
  toolCards?: PluginToolCardDescriptor[]
  configPages?: PluginConfigPageDescriptor[]
  messageWindows?: PluginMessageWindowDescriptor[]
}

/** Declarative action exposed to the gateway action registry. */
export interface PluginActionDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema?: PluginJsonSchema
  outputSchema?: PluginJsonSchema
  /** Per-action timeout; defaults to PLUGIN_UI_LIMITS.defaultActionTimeoutMs. */
  timeoutMs?: number
}

/** Registered package event, always in the `plugin:<package>:<event>` namespace. */
export interface PluginEventDescriptor {
  type: string
  title?: string
  description?: string
  schema?: PluginJsonSchema
  /**
   * Delivery scope declared by the package (`global` default semantics live in
   * the Host). Preserved on the client descriptor so Desktop and later Host
   * work can reason about the declaration without re-reading Host state.
   */
  scope?: "global" | "session"
}

export interface PluginDiagnostic {
  level: "error" | "warning" | "info"
  message: string
  code?: string
}

/**
 * Sanitized package descriptor sent to Desktop.
 *
 * Contains serializable data only: package identity, revision, UI
 * declarations, action/event metadata and diagnostics. Never Host handlers,
 * source or functions.
 */
export interface PluginClientDescriptor {
  name: string
  version: string
  revision: string
  title?: string
  description?: string
  ui: PluginUiContribution
  actions: PluginActionDescriptor[]
  events: PluginEventDescriptor[]
  diagnostics?: PluginDiagnostic[]
}
