import { describe, expect, test } from "bun:test"
import { checkbox, group, item, radio, sep, submenu, validateMenu } from "./model"
import type { MenuModel } from "./types"

const m = (items: MenuModel["items"]): MenuModel => ({ surface: "session.row", items })

describe("validateMenu", () => {
  test("accepts a well-formed model", () => {
    expect(validateMenu(m([
      item("s.open", "打开"),
      item("s.copy", "复制"),
      sep(),
      item("s.delete", "删除…", { danger: true, confirms: true }),
    ]))).toEqual([])
  })

  test("reports duplicate ids and separator misuse", () => {
    const errors = validateMenu(m([
      sep(),
      item("x", "A"),
      sep(),
      sep(),
      item("x", "B"),
    ]))
    expect(errors).toContain("leading separator")
    expect(errors).toContain("consecutive separators")
    expect(errors).toContain("duplicate id: x")
  })

  test("danger must be last and confirms must use an ellipsis", () => {
    const errors = validateMenu(m([
      item("bad", "删除", { danger: true, confirms: true }),
      sep(),
      item("ok", "打开"),
    ]))
    expect(errors).toContain("danger item before last separator: bad")
    expect(errors).toContain("confirms label must end with …: bad")
    expect(validateMenu(m([item("solo", "删除…", { danger: true, confirms: true })])))
      .toContain("danger item requires a separator: solo")
  })

  test("group size, submenu depth and empty submenu", () => {
    const tooMany = validateMenu(m([
      item("a1", "1"), item("a2", "2"), item("a3", "3"), item("a4", "4"),
      item("a5", "5"), item("a6", "6"), item("a7", "7"), item("a8", "8"),
    ]))
    expect(tooMany).toContain("too many items in group: 8")

    const badSubs = validateMenu(m([
      submenu("sub", "更多", [submenu("deep", "更深", [item("d", "D")])]),
      submenu("empty", "空", []),
    ]))
    expect(badSubs).toContain("submenu depth > 1: sub")
    expect(badSubs).toContain("empty submenu: empty")
  })

  test("checkbox, radio and group are id-checked", () => {
    expect(validateMenu(m([
      group("g", "分组", [checkbox("c", "显示", true)]),
      radio("r", "紧凑", true),
    ]))).toEqual([])
  })
})
