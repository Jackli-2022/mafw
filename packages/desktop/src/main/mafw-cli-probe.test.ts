import { describe, expect, test } from "bun:test"
import { parseMafwVersion, probeMafwCli, type CliVersionRunner } from "./mafw-cli-probe"

function runnerOf(output: string, error?: Error): CliVersionRunner {
  return error
    ? () => Promise.reject(error)
    : () => Promise.resolve(output)
}

describe("parseMafwVersion", () => {
  test("parses v-prefixed semver", () => {
    expect(parseMafwVersion("v4.1.0\n")).toBe("4.1.0")
  })

  test("parses bare semver", () => {
    expect(parseMafwVersion("5.0.0")).toBe("5.0.0")
  })

  test("parses prerelease semver", () => {
    expect(parseMafwVersion("v1.2.3-beta.1")).toBe("1.2.3-beta.1")
  })

  test("returns null for garbage", () => {
    expect(parseMafwVersion("mafw is not recognized")).toBeNull()
  })
})

describe("probeMafwCli", () => {
  test("available with parsed version when 'mafw version' succeeds", async () => {
    const probe = await probeMafwCli(runnerOf("v4.1.0\n"))
    expect(probe).toEqual({ available: true, version: "4.1.0" })
  })

  test("unavailable with reason when the command fails", async () => {
    const probe = await probeMafwCli(runnerOf("", new Error("command not found")))
    expect(probe.available).toBe(false)
    if (!probe.available) expect(probe.reason).toContain("command not found")
  })

  test("unavailable when output has no version", async () => {
    const probe = await probeMafwCli(runnerOf("hello world\n"))
    expect(probe.available).toBe(false)
  })
})
