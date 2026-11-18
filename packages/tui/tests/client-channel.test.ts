import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createTuiClient } from "../src/store/human-token.ts"

interface Captured {
  url: string
  init?: RequestInit
}

function fakeFetch(calls: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => ({ id: "p1", worktree: "/proj" }),
    } as unknown as Response
  }) as typeof fetch
}

describe("tui client channel", () => {
  test("declares x-mafw-client: tui", async () => {
    const calls: Captured[] = []
    const client = createTuiClient("http://127.0.0.1:4321", fakeFetch(calls))

    await client.project.current()

    assert.equal(new Headers(calls[0]?.init?.headers).get("x-mafw-client"), "tui")
  })
})
