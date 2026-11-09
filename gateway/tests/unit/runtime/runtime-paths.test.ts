import { join } from "node:path"
import { mafwRuntimeDir } from "../../../src/runtime/runtime-paths"

describe("mafwRuntimeDir", () => {
  test("defaults to <home>/.mafw/runtime", () => {
    expect(mafwRuntimeDir("/home/me", {})).toBe(join("/home/me", ".mafw", "runtime"))
  })

  test("honours the MAFW_RUNTIME_DIR override", () => {
    expect(mafwRuntimeDir("/home/me", { MAFW_RUNTIME_DIR: "/tmp/mafw-runtime" }))
      .toBe("/tmp/mafw-runtime")
  })

  test("an empty override falls back to the default", () => {
    expect(mafwRuntimeDir("/home/me", { MAFW_RUNTIME_DIR: "  " }))
      .toBe(join("/home/me", ".mafw", "runtime"))
  })
})
