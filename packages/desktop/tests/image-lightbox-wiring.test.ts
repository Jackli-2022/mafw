import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", file), "utf8")

test("data image anchors open the app lightbox", () => {
  assert.match(read("components/tool-cards/python.tsx"), /openImageLightbox/)
  assert.match(read("components/UserPluginCards.tsx"), /openImageLightbox/)
  assert.match(read("MafwShell.tsx"), /<ImageLightbox/)
})
