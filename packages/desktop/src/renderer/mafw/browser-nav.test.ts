import { test } from "node:test"
import assert from "node:assert/strict"
import {
  browserNavRequest,
  requestBrowserNavigate,
  takeBrowserNavRequest,
} from "./browser-nav"

test("browser nav request is consumed exactly once", () => {
  requestBrowserNavigate("https://example.com/a", { newTab: true })
  const first = takeBrowserNavRequest()
  assert.equal(first?.url, "https://example.com/a")
  assert.equal(first?.newTab, true)
  assert.equal(browserNavRequest(), null)
  assert.equal(takeBrowserNavRequest(), null)
})
