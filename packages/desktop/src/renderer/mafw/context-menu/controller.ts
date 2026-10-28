import { createSignal } from "solid-js"
import { clampMenuPoint, type Point } from "./clamp"
import type { MenuModel, MenuOpenSource } from "./types"

export interface MenuRequest {
  model: MenuModel
  run: (id: string) => void
  point: Point
  from: MenuOpenSource
}

export interface MenuRequestOptions {
  point?: Point
  from?: MenuOpenSource
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

export function createMenuController(): MenuController {
  const [request, setRequest] = createSignal<MenuRequest | null>(null)

  return {
    request(build, target, run, opts = {}) {
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const point = clampMenuPoint(
        opts.point ?? { x: viewport.width / 2, y: viewport.height / 2 },
        viewport,
      )
      setRequest({ model: build(target), run, point, from: opts.from ?? "contextmenu" })
    },
    close() {
      setRequest(null)
    },
    current: request,
    point() {
      return request()?.point ?? { x: 0, y: 0 }
    },
  }
}

export const menuController = createMenuController()
