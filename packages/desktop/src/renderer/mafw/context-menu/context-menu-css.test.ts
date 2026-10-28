import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "context-menu.css"), "utf8")

test("danger items are visually distinct", () => {
  expect(css).toMatch(/\[data-danger\][^{]*\{[^}]*color:\s*var\(--danger/)
})

test("shortcut column and icon slot exist", () => {
  expect(css).toMatch(/\.mafw-context-menu-shortcut\s*\{/)
  expect(css).toMatch(/\.mafw-context-menu-icon\s*\{/)
})

test("menu sits above modal overlays", () => {
  expect(css).toMatch(/z-index:\s*1000/)
})
