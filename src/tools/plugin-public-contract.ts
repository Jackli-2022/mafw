/**
 * Public plugin contract snapshot, as taught to the Creator agent.
 *
 * This is a deliberate copy, not an import: it is the "what the host accepts
 * today" answer the inspect tool hands the model, and drift must be a test
 * failure. `tests/plugin-creator-tools.test.ts` asserts these values equal the
 * real `@mafw/plugin-contract` exports — update both together.
 *
 * Keep this file free of gateway/Node imports so it stays trivially safe to
 * load from a tool and easy to diff.
 */

/** The four first-phase UI contribution slots. Unknown slots are rejected. */
export const PLUGIN_UI_SLOTS = [
  'panels',
  'toolCards',
  'configPages',
  'messageWindows',
] as const;

/** Declarative widget vocabulary rendered by Desktop. */
export const PLUGIN_WIDGET_TYPES = [
  'text',
  'code',
  'kv',
  'tags',
  'list',
  'row',
  'image',
  'link',
  'markdown',
  'progress',
  'action',
] as const;

/** Exact copy of `PLUGIN_UI_LIMITS` (`packages/plugin-contract/src/limits.ts`). */
export const PLUGIN_UI_LIMITS_SNAPSHOT = {
  maxWidgets: 256,
  maxDepth: 12,
  maxTextBytes: 64 * 1024,
  maxImageDataUrlBytes: 2 * 1024 * 1024,
  maxToolPayloadBytes: 256 * 1024,
  maxActionPayloadBytes: 256 * 1024,
  defaultActionTimeoutMs: 15_000,
  maxActionTimeoutMs: 60_000,
} as const;

export const PLUGIN_PUBLIC_CONTRACT = {
  slots: PLUGIN_UI_SLOTS,
  widgetTypes: PLUGIN_WIDGET_TYPES,
  limits: PLUGIN_UI_LIMITS_SNAPSHOT,
} as const;

export type PluginPublicContract = typeof PLUGIN_PUBLIC_CONTRACT;
