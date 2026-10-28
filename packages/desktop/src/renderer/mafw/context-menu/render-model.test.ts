import { expect, test } from "bun:test"
import { toRenderRows } from "./render-model"
import { checkbox, group, item, radio, sep, submenu } from "./model"
import type { MenuModel } from "./types"

test("groups and submenus flatten into render rows", () => {
  const model: MenuModel = {
    surface: "file.path",
    items: [
      item("a", "A"),
      group("g", "分组", [item("b", "B")]),
      submenu("s", "更多", [item("c", "C")]),
      sep(),
      item("d", "删除…", { danger: true }),
    ],
  }
  const rows = toRenderRows(model)
  expect(rows.map((row) => row.kind)).toEqual(["item", "group", "submenu", "separator", "item"])
  expect(rows[1]).toMatchObject({ kind: "group", rows: [{ kind: "item" }] })
})

test("checkbox and radio survive the mapping", () => {
  const rows = toRenderRows({
    surface: "session.row",
    items: [checkbox("c", "显示", true), radio("r", "紧凑", false)],
  })
  expect(rows.map((row) => row.kind)).toEqual(["checkbox", "radio"])
})

test("empty model yields no rows", () => {
  expect(toRenderRows(null)).toEqual([])
  expect(toRenderRows(undefined)).toEqual([])
})
