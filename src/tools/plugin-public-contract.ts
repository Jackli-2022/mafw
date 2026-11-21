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

/** The UI contribution slots. Unknown slots are rejected. */
export const PLUGIN_UI_SLOTS = [
  'panels',
  'toolCards',
  'configPages',
  'messageWindows',
  'webSurfaces',
] as const;

/**
 * Field reference for `ui.webSurfaces[]` — the sandboxed Web page slot.
 *
 * Unlike the four declarative slots, a Web surface is an actual page shipped in
 * the package's `web/` directory. `entry` must resolve below `web/` or the whole
 * package fails activation; `url` is added by the gateway in the client
 * descriptor and is never written by the package.
 */
export const PLUGIN_WEB_SURFACE_FIELDS = {
  id: 'string, required, unique in the package and against ui.panels ids',
  title: 'string, required, max 80 chars',
  icon: 'optional glyph name from the plugin icon whitelist',
  entry: 'optional file below web/, default index.html; no "..", absolute paths or scheme',
  scope: 'session (default) | project | global',
  reloadOnSessionChange: 'boolean, default true',
  rail: 'optional left-rail entry { icon (required), order (default 100), badge (default false) }',
  url: 'read-only, added by the gateway: /api/plugins/<package>/ui/<entry>',
} as const;

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
  maxMenuItems: 20,
  maxComposerActions: 3,
  maxToolPayloadBytes: 256 * 1024,
  maxActionPayloadBytes: 256 * 1024,
  defaultActionTimeoutMs: 15_000,
  maxActionTimeoutMs: 60_000,
} as const;

export const PLUGIN_PUBLIC_CONTRACT = {
  slots: PLUGIN_UI_SLOTS,
  webSurfaceFields: PLUGIN_WEB_SURFACE_FIELDS,
  widgetTypes: PLUGIN_WIDGET_TYPES,
  limits: PLUGIN_UI_LIMITS_SNAPSHOT,
} as const;

export type PluginPublicContract = typeof PLUGIN_PUBLIC_CONTRACT;
