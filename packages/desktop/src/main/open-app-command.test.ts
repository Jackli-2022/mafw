import { describe, expect, test } from "bun:test"
import { appOpenCommand } from "./open-app-command"

describe("appOpenCommand", () => {
  test("macOS uses open -a", () => {
    expect(appOpenCommand("darwin", "Visual Studio Code", "/tmp/a.ts")).toEqual({
      cmd: "open",
      args: ["-a", "Visual Studio Code", "/tmp/a.ts"],
    })
  })

  test("Windows goes through cmd.exe so .cmd shims work and spaces are quoted", () => {
    expect(appOpenCommand("win32", "code", "C:\\a b\\c.ts")).toEqual({
      cmd: "cmd.exe",
      args: ["/d", "/s", "/c", 'code "C:\\a b\\c.ts"'],
    })
  })

  test("Linux invokes the binary directly", () => {
    expect(appOpenCommand("linux", "code", "/tmp/a.ts")).toEqual({
      cmd: "code",
      args: ["/tmp/a.ts"],
    })
  })
})
