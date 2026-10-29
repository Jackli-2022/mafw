import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface BrowserPageMenuTarget {
  url: string
  linkURL?: string
  selectionText?: string
  imageURL?: string
  canBack: boolean
  canForward: boolean
}

export function buildBrowserPageMenu(target: BrowserPageMenuTarget): MenuModel {
  const targetItems: MenuItem[] = []
  if (target.selectionText) {
    targetItems.push(item("browserPage.copySelection", L.browserPage.copySelection))
  }
  if (target.linkURL) {
    targetItems.push(
      item("browserPage.copyLink", L.browserPage.copyLink),
      item("browserPage.openLink", L.browserPage.openLink),
    )
  }
  if (target.imageURL) {
    targetItems.push(item("browserPage.copyImageUrl", L.browserPage.copyImageUrl))
  }

  const navigation: MenuItem[] = [
    item("browserPage.back", L.browser.back, target.canBack
      ? {}
      : { disabled: true, disabledReason: "没有上一页" }),
    item("browserPage.forward", L.browser.forward, target.canForward
      ? {}
      : { disabled: true, disabledReason: "没有下一页" }),
    item("browserPage.reload", L.browser.reload),
    item("browserPage.openExternal", L.browser.openExternal),
  ]

  return {
    surface: "browser.page",
    items: targetItems.length > 0 ? [...targetItems, sep(), ...navigation] : navigation,
  }
}
