import { group, item, validateMenu } from "./model"
import type { MenuModel, MenuSurface } from "./types"

/** The menu grammar already caps a group at 7 items; use the same budget. */
export const MAX_CONTRIBUTIONS_PER_SURFACE = 7

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export interface MenuContributionContext {
  surface: MenuSurface
  /** The object the menu was opened for (session, message, file, ...). */
  target: unknown
}

export interface MenuContribution {
  /** Stable per-surface id; becomes `contrib:<id>` in the menu model. */
  id: string
  surface: MenuSurface
  label: string
  /** Host-side action for the spike. A package action id will replace it later. */
  run: (context: MenuContributionContext) => void | Promise<void>
  icon?: string
  shortcut?: string
  /** Lower first; ties fall back to label, then id. */
  order?: number
  disabled?: boolean
  disabledReason?: string
  /** Reserved: danger items need an insertion policy around the final danger block. */
  danger?: boolean
}

export interface MergedMenu {
  model: MenuModel
  /** Returns true when the id belonged to a contribution. */
  run(id: string): boolean
}

export class MenuContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MenuContributionError"
  }
}

/**
 * Host-side registry for the context-menu extension point.
 *
 * The spike deliberately keeps contributions as host callbacks. The public
 * plugin-package projection (data-only `{label, action}` + a gateway action
 * handler) can be layered on top without changing the merge point.
 */
export class MenuContributionRegistry {
  private readonly entries = new Map<string, MenuContribution>()

  register(contribution: MenuContribution): () => void {
    if (!ID_PATTERN.test(contribution.id)) {
      throw new MenuContributionError(`invalid contribution id: ${contribution.id}`)
    }
    if (!contribution.label.trim()) {
      throw new MenuContributionError(`contribution ${contribution.id} has an empty label`)
    }
    if (contribution.danger) {
      throw new MenuContributionError(
        `danger contribution ${contribution.id} is reserved until the insertion policy is defined`,
      )
    }
    if (this.entries.has(contribution.id)) {
      throw new MenuContributionError(`duplicate contribution id: ${contribution.id}`)
    }
    const sameSurface = this.list(contribution.surface)
    if (sameSurface.length >= MAX_CONTRIBUTIONS_PER_SURFACE) {
      throw new MenuContributionError(
        `too many contributions for surface ${contribution.surface} (max ${MAX_CONTRIBUTIONS_PER_SURFACE})`,
      )
    }
    this.entries.set(contribution.id, contribution)
    return () => {
      if (this.entries.get(contribution.id) === contribution) this.entries.delete(contribution.id)
    }
  }

  list(surface?: MenuSurface): MenuContribution[] {
    const entries = [...this.entries.values()].filter(
      (entry) => surface === undefined || entry.surface === surface,
    )
    return entries.sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    )
  }

  clear(): void {
    this.entries.clear()
  }

  /**
   * Appends matching contributions as one `扩展` group. A candidate that fails
   * the existing menu grammar is rejected as a whole (fail-open: the built-in
   * menu is returned unchanged).
   */
  merge(model: MenuModel, context: MenuContributionContext): MergedMenu {
    const contributions = this.list(model.surface)
    if (contributions.length === 0) {
      return { model, run: () => false }
    }

    const items = contributions.map((contribution) =>
      item(`contrib:${contribution.id}`, contribution.label, {
        icon: contribution.icon,
        shortcut: contribution.shortcut,
        disabled: contribution.disabled,
        disabledReason: contribution.disabledReason,
      }),
    )
    const candidate: MenuModel = {
      ...model,
      items: [...model.items, group(`contrib:${model.surface}`, "扩展", items)],
    }
    if (validateMenu(candidate).length > 0) {
      return { model, run: () => false }
    }

    const byId = new Map(
      contributions.map((contribution) => [`contrib:${contribution.id}`, contribution]),
    )
    return {
      model: candidate,
      run(id: string): boolean {
        const contribution = byId.get(id)
        if (!contribution) return false
        try {
          const result = contribution.run(context)
          if (result && typeof (result as Promise<void>).catch === "function") {
            void (result as Promise<void>).catch(() => {})
          }
        } catch {
          /* a contribution failure must not close or poison the menu */
        }
        return true
      },
    }
  }
}

/** App-wide registry used by the default `menuController`. */
export const menuContributions = new MenuContributionRegistry()
