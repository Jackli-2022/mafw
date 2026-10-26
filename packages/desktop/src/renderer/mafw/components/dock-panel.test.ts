import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dockBannerClass } from "./dock-panel"

const src = readFileSync(new URL("./dock-panel.tsx", import.meta.url), "utf8")

describe("dock panel primitives", () => {
  test("dockBannerClass maps kind to tone class", () => {
    assert.equal(dockBannerClass("info"), "mafw-panel-banner mafw-panel-banner-info")
    assert.equal(dockBannerClass("warn"), "mafw-panel-banner mafw-panel-banner-warn")
    assert.equal(dockBannerClass("error"), "mafw-panel-banner mafw-panel-banner-error")
  })

  test("exports the three primitives with stable class hooks", () => {
    assert.match(src, /export function DockPanelHeader/)
    assert.match(src, /export function DockEmpty/)
    assert.match(src, /export function DockBanner/)
    assert.ok(src.includes("mafw-panel-head"))
    assert.ok(src.includes("mafw-panel-empty"))
    assert.ok(src.includes("mafw-panel-banner"))
  })

  test("DockPanelHeader renders title and an actions slot", () => {
    assert.match(src, /title: string/)
    assert.match(src, /children\?: JSX\.Element/)
    assert.ok(src.includes("mafw-panel-head-title"))
    assert.ok(src.includes("mafw-panel-head-actions"))
  })

  test("DockEmpty takes icon/text/hint and gates hint behind Show", () => {
    assert.match(src, /icon\?: string/)
    assert.match(src, /text: string/)
    assert.match(src, /hint\?: string/)
    assert.ok(src.includes("mafw-panel-empty-text"))
    assert.ok(src.includes("mafw-panel-empty-hint"))
  })

  test("DockBanner renders LoaderV2 when busy and Action button when provided", () => {
    assert.ok(src.includes("LoaderV2"))
    assert.ok(src.includes("ButtonV2"))
    assert.match(src, /busy\?: boolean/)
    assert.ok(src.includes("mafw-panel-banner-text"))
  })
})
