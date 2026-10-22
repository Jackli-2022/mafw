import { describe, expect, test } from "bun:test"
import { langForFile } from "./cm-lang"

test("常见扩展名映射；未知 → null；大小写不敏感", () => {
  expect(langForFile("src/a.ts")).toBe("typescript")
  expect(langForFile("x/Component.TSX")).toBe("typescript")
  expect(langForFile("a/b.py")).toBe("python")
  expect(langForFile("README.md")).toBe("markdown")
  expect(langForFile("style.CSS")).toBe("css")
  expect(langForFile("data.json")).toBe("json")
  expect(langForFile("x.unknownext")).toBeNull()
})
