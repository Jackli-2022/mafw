import { createSignal } from "solid-js"
import { clampMenuPoint, type Point } from "./clamp"
import { menuContributions, type MenuContributionRegistry } from "./contributions"
import { shouldRestoreFocus } from "./focus"
import type { MenuModel, MenuOpenSource } from "./types"

export interface MenuRequest {
  model: MenuModel
  run: (id: string) => void
  point: Point
  from: MenuOpenSource
  returnFocus?: HTMLElement | null
}

export interface MenuRequestOptions {
  point?: Point
  from?: MenuOpenSource
  returnFocus?: HTMLElement | null
}

export interface MenuController {
  request<T>(
    build: (target: T) => MenuModel,
    target: T,
    run: (id: string) => void,
    opts?: MenuRequestOptions,
  ): void
  close(): void
  current(): MenuRequest | null
  point(): Point
}

export interface MenuControllerOptions {
  /** `null` disables contributions (useful for isolated tests). */
  contributions?: MenuContributionRegistry | null
}

export function createMenuController(options: MenuControllerOptions = {}): MenuController {
  const [request, setRequest] = createSignal<MenuRequest | null>(null)
  const contributions =
    options.contributions === undefined ? menuContributions : options.contributions

  return {
    request(build, target, run, opts = {}) {
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const point = clampMenuPoint(
        opts.point ?? { x: viewport.width / 2, y: viewport.height / 2 },
        viewport,
      )
      const built = build(target)
      const merged = contributions?.merge(built, { surface: built.surface, target })
      const model = merged?.model ?? built
      const finalRun = merged
        ? (id: string) => {
            if (!merged.run(id)) run(id)
          }
        : run
      setRequest({
        model,
        run: finalRun,
        point,
        from: opts.from ?? "contextmenu",
        returnFocus: opts.returnFocus ?? (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null),
      })
    },
    close() {
      const returnFocus = request()?.returnFocus ?? null
      setRequest(null)
      queueMicrotask(() => {
        if (!returnFocus?.isConnected) return
        if (!shouldRestoreFocus(document.activeElement as any)) return
        returnFocus.focus?.({ preventScroll: true })
      })
    },
    current: request,
    point() {
      return request()?.point ?? { x: 0, y: 0 }
    },
  }
}

export const menuController = createMenuController()
