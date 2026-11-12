import { test } from "node:test"
import assert from "node:assert/strict"
import { isPluginSurfaceId, parsePluginSurfaceId, pluginSurfaceId } from "./surface-id"

test("plugin surface ids round-trip and reject invalid values", () => {
  const id = pluginSurfaceId("pkg", "panel-1")
  assert.equal(id, "plugin:pkg:panel-1")
  assert.deepEqual(parsePluginSurfaceId(id), { package: "pkg", panel: "panel-1" })
  assert.equal(isPluginSurfaceId(id), true)
  assert.equal(parsePluginSurfaceId("plugin:pkg"), null)
  assert.equal(parsePluginSurfaceId("plugin::panel"), null)
  assert.equal(parsePluginSurfaceId("plugin:pkg:bad panel"), null)
  assert.equal(isPluginSurfaceId("code"), false)
})
