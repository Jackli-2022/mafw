import { describe, expect, test } from "bun:test"
import { parseDeepLink } from "./deep-link"

describe("parseDeepLink", () => {
  test("parses mafw://session/<id>", () => {
    expect(parseDeepLink("mafw://session/ses_abc123")).toEqual({ kind: "session", id: "ses_abc123" })
  })

  test("parses mafw://tab/<name> for known tabs", () => {
    expect(parseDeepLink("mafw://tab/goals")).toEqual({ kind: "tab", id: "goals" })
    expect(parseDeepLink("mafw://tab/memory")).toEqual({ kind: "tab", id: "memory" })
  })

  test("rejects unknown tab names", () => {
    expect(parseDeepLink("mafw://tab/nonsense")).toBeNull()
  })

  test("returns null for other schemes/hosts/paths", () => {
    expect(parseDeepLink("https://session/x")).toBeNull()
    expect(parseDeepLink("mafw://unknown/x")).toBeNull()
    expect(parseDeepLink("mafw://session/")).toBeNull()
    expect(parseDeepLink("not a url")).toBeNull()
  })

  test("ignores query strings and trailing slashes", () => {
    expect(parseDeepLink("mafw://session/ses_x?from=tray")).toEqual({ kind: "session", id: "ses_x" })
    expect(parseDeepLink("mafw://tab/triage/")).toEqual({ kind: "tab", id: "triage" })
  })
})
