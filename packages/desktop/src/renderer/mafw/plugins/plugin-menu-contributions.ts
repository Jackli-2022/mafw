// Phase 4 / S4: project committed plugin `ui.menuItems` into the host-side
// context-menu contribution registry.
//
// The renderer only consumes data. Each contribution's `run` calls the
// package's declared gateway action; handler code never crosses the process
// boundary and no Solid component is injected by a package.
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import type { MenuContribution, MenuContributionContext } from "../context-menu/contributions"
import { MENU_SURFACES, type MenuSurface } from "../context-menu/types"

export interface PluginMenuSyncDeps {
  descriptors: readonly PluginClientDescriptor[]
  register: (contribution: MenuContribution) => () => void
  invoke: (
    pkg: string,
    action: string,
    input?: unknown,
    sessionID?: string,
  ) => Promise<unknown>
  sessionID?: () => string | null
  onError?: (message: string) => void
}

const MENU_SURFACE_SET: ReadonlySet<string> = new Set(MENU_SURFACES)

function isMenuSurface(value: string): value is MenuSurface {
  return MENU_SURFACE_SET.has(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Registers every valid menu item from the committed descriptors and returns a
 * disposer. Invalid items/surfaces/actions are skipped (fail-open); one bad
 * package never prevents the rest from contributing.
 */
export function applyPluginMenuDescriptors(deps: PluginMenuSyncDeps): () => void {
  const disposers: Array<() => void> = []

  for (const descriptor of deps.descriptors) {
    const menuItems = descriptor.ui?.menuItems ?? []
    if (menuItems.length === 0) continue
    const actionNames = new Set(descriptor.actions.map((action) => action.name))

    for (const item of menuItems) {
      if (!isMenuSurface(item.surface)) {
        deps.onError?.(
          `package ${descriptor.name} menu item ${item.id} has unsupported surface "${item.surface}"`,
        )
        continue
      }
      if (!actionNames.has(item.action)) {
        deps.onError?.(
          `package ${descriptor.name} menu item ${item.id} references undeclared action "${item.action}"`,
        )
        continue
      }

      const contribution: MenuContribution = {
        id: `plugin:${descriptor.name}:${item.id}`,
        surface: item.surface,
        label: item.label,
        ...(item.icon ? { icon: item.icon } : {}),
        ...(item.shortcut ? { shortcut: item.shortcut } : {}),
        ...(item.order !== undefined ? { order: item.order } : {}),
        run: (_context: MenuContributionContext) => {
          const sessionID = deps.sessionID?.() ?? undefined
          try {
            const result = deps.invoke(descriptor.name, item.action, {}, sessionID)
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch((error: unknown) => {
                deps.onError?.(
                  `package ${descriptor.name} menu action ${item.action} failed: ${messageOf(error)}`,
                )
              })
            }
          } catch (error) {
            deps.onError?.(
              `package ${descriptor.name} menu action ${item.action} failed: ${messageOf(error)}`,
            )
          }
        },
      }

      try {
        disposers.push(deps.register(contribution))
      } catch (error) {
        deps.onError?.(
          `package ${descriptor.name} menu item ${item.id} could not be registered: ${messageOf(error)}`,
        )
      }
    }
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* teardown is fail-open */
      }
    }
  }
}
