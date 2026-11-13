// Phase 4 / composer action: project committed `ui.composerActions` into plain
// host-rendered button data. The package handler stays in the gateway; Desktop
// only invokes the declared action and optionally inserts returned draft text.
import { isPluginIconName, type PluginClientDescriptor } from "@mafw/plugin-contract"

export interface PluginComposerAction {
  id: string
  packageName: string
  label: string
  action: string
  icon: string
  order?: number
  run: (sessionID: string) => Promise<void>
}

export interface PluginComposerActionDeps {
  descriptors: readonly PluginClientDescriptor[]
  invoke: (
    pkg: string,
    action: string,
    input?: unknown,
    sessionID?: string,
  ) => Promise<unknown>
  onInsert?: (sessionID: string, text: string) => void
  onError?: (message: string) => void
}

const FALLBACK_ICON = "plus"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sorted<T extends { order?: number; label: string; id: string }>(items: T[]): T[] {
  return items.sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  )
}

/**
 * Returns valid composer actions from the committed descriptors. Items whose
 * action is not declared by the same package are skipped; unknown icons fall
 * back to the shell's `plus` glyph instead of failing the whole package.
 */
export function composerActionsFromDescriptors(
  deps: PluginComposerActionDeps,
): PluginComposerAction[] {
  const actions: PluginComposerAction[] = []

  for (const descriptor of deps.descriptors) {
    const declared = descriptor.ui?.composerActions ?? []
    if (declared.length === 0) continue
    const actionNames = new Set(descriptor.actions.map((action) => action.name))

    for (const item of declared) {
      if (!actionNames.has(item.action)) {
        deps.onError?.(
          `package ${descriptor.name} composer action ${item.id} references undeclared action "${item.action}"`,
        )
        continue
      }
      const icon =
        typeof item.icon === "string" && isPluginIconName(item.icon)
          ? item.icon
          : FALLBACK_ICON
      actions.push({
        id: `plugin:${descriptor.name}:${item.id}`,
        packageName: descriptor.name,
        label: item.label,
        action: item.action,
        icon,
        ...(item.order !== undefined ? { order: item.order } : {}),
        run: async (sessionID: string): Promise<void> => {
          try {
            const result = await deps.invoke(
              descriptor.name,
              item.action,
              {},
              sessionID,
            )
            if (
              result &&
              typeof result === "object" &&
              typeof (result as { insertText?: unknown }).insertText === "string"
            ) {
              deps.onInsert?.(
                sessionID,
                (result as { insertText: string }).insertText,
              )
            }
          } catch (error) {
            deps.onError?.(
              `package ${descriptor.name} composer action ${item.action} failed: ${messageOf(error)}`,
            )
          }
        },
      })
    }
  }

  return sorted(actions)
}
