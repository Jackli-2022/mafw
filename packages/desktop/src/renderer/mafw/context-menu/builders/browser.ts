import { L } from "../labels"
import { item } from "../model"
import type { MenuModel } from "../types"

export interface BrowserMenuTarget {
  url: string
  canBack: boolean
  canForward: boolean
  started: boolean
  canPick: boolean
}

export function buildBrowserMenu(target: BrowserMenuTarget): MenuModel {
  const noUrl = target.url.trim().length === 0
  return {
    surface: "browser",
    items: [
      item("browser.back", L.browser.back, target.canBack
        ? {}
        : { disabled: true, disabledReason: "没有上一页" }),
      item("browser.forward", L.browser.forward, target.canForward
        ? {}
        : { disabled: true, disabledReason: "没有下一页" }),
      item("browser.reload", L.browser.reload, target.started
        ? {}
        : { disabled: true, disabledReason: "页面尚未加载" }),
      item("browser.copyLink", L.browser.copyLink, noUrl
        ? { disabled: true, disabledReason: "地址栏为空" }
        : {}),
      item("browser.openExternal", L.browser.openExternal, noUrl
        ? { disabled: true, disabledReason: "地址栏为空" }
        : {}),
      item("browser.pick", L.browser.pick, target.canPick
        ? {}
        : { disabled: true, disabledReason: "当前页面不可点选" }),
    ],
  }
}
