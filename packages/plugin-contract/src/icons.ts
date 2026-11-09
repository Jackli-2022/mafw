/**
 * Glyph names a plugin may reference from `ui.webSurfaces[]`.
 *
 * This is a names-only copy of the glyphs the Desktop rail already renders, so
 * a package can never point at a glyph that does not exist (an unknown name is
 * a validation error, never a silent fallback). Names are pinned against the
 * `@mafw/ui` icon registry by the Desktop side; this module deliberately does
 * not import `@mafw/ui` because the contract package must stay free of
 * renderer/DOM dependencies.
 *
 * Note: the git/worktree glyph registered by `@mafw/ui` is named `branch`
 * there; there is no `git-branch` glyph, so the working name is used.
 */
export const PLUGIN_ICON_NAMES = [
  "bubble-5",
  "magnifying-glass",
  "sticky-note",
  "team-three",
  "checklist",
  "layout-grid",
  "square-arrow-top-right",
  "refresh",
  "plus",
  "file",
  "folder",
  "terminal",
  "branch",
  "globe",
] as const

const PLUGIN_ICON_NAME_SET: ReadonlySet<string> = new Set(PLUGIN_ICON_NAMES)

/** True when `value` is a glyph name a plugin surface may declare. */
export function isPluginIconName(value: unknown): boolean {
  return typeof value === "string" && PLUGIN_ICON_NAME_SET.has(value)
}
