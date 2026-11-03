/**
 * Hard limits for declarative plugin UI and Host actions.
 *
 * These values are part of the public contract: gateway, SDK and Desktop all
 * validate against the same numbers so a payload accepted by one surface is
 * not silently rejected by another.
 */
export const PLUGIN_UI_LIMITS = {
  /** Maximum number of Widget nodes in one PluginView tree. */
  maxWidgets: 256,
  /** Maximum nesting depth of a Widget tree (root body widget = 1). */
  maxDepth: 12,
  /** Maximum UTF-8 bytes for any single text-bearing widget field. */
  maxTextBytes: 64 * 1024,
  /** Maximum bytes for an image widget's data URL. */
  maxImageDataUrlBytes: 2 * 1024 * 1024,
  /** Maximum bytes of a tool-card payload sent to a plugin view action. */
  maxToolPayloadBytes: 256 * 1024,
  /** Maximum bytes of an action input or output payload. */
  maxActionPayloadBytes: 256 * 1024,
  /** Default timeout applied when an action does not declare one. */
  defaultActionTimeoutMs: 15_000,
  /** Hard ceiling for any declared action timeout. */
  maxActionTimeoutMs: 60_000,
} as const

export type PluginUiLimits = typeof PLUGIN_UI_LIMITS
