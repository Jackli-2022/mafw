import { describe, expect, test } from "bun:test"
import { resolvePath } from "./paths"

describe("resolvePath", () => {
  test("relative path joins under the root", () => {
    expect(resolvePath("C:/work/proj", "src/a.ts")).toEqual({
      abs: "C:/work/proj/src/a.ts",
      inRoot: true,
    })
  })

  test("Windows drive and UNC paths stay absolute and out of root", () => {
    expect(resolvePath("C:/work/proj", "C:\\work\\x\\a.ts")).toEqual({
      abs: "C:\\work\\x\\a.ts",
      inRoot: false,
    })
    expect(resolvePath("C:/work/proj", "\\\\server\\share\\a.ts")).toEqual({
      abs: "\\\\server\\share\\a.ts",
      inRoot: false,
    })
  })

  test("POSIX absolute paths stay absolute and out of root", () => {
    expect(resolvePath("/home/me/proj", "/etc/hosts")).toEqual({ abs: "/etc/hosts", inRoot: false })
  })

  test("parent escapes are out of root", () => {
    expect(resolvePath("C:/work/proj", "../x/a.ts")).toMatchObject({ inRoot: false })
    expect(resolvePath("C:/work/proj", "src/../../x/a.ts")).toMatchObject({ inRoot: false })
  })

  test("empty rel is empty and out of root", () => {
    expect(resolvePath("C:/work/proj", "")).toEqual({ abs: "", inRoot: false })
  })
})
