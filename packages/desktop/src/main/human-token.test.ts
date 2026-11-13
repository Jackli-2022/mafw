// E5a-4: the desktop main process reads the human token from the data root and
// injects it into every gateway client.
// Spec §5.2 — read `~/.mafw/human.token`, trim, validate, never throw, never log.
//
// The client tests below are behavioral: a fake fetch captures the real headers
// the SDK produces, so a regression in either the helper or the SDK merge shows
// up here instead of in a source-text scan.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createGatewayClient, humanTokenPath, isStaleHumanTokenError, readHumanToken, withHumanTokenRetry } from "./human-token"

const TOKEN = "0123456789abcdef".repeat(4) // 64 lowercase hex chars

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mafw-human-token-"))
  roots.push(root)
  return root
}

function writeTokenFile(content: string): string {
  const file = join(tempRoot(), "human.token")
  writeFileSync(file, content, "utf-8")
  return file
}

const ENV_KEY = "MAFW_HUMAN_TOKEN_FILE"

beforeEach(() => {
  delete process.env[ENV_KEY]
})

afterEach(() => {
  delete process.env[ENV_KEY]
  while (roots.length > 0) {
    const root = roots.pop()!
    try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe("readHumanToken", () => {
  test("reads a well-formed token and trims trailing newline", () => {
    expect(readHumanToken(writeTokenFile(`${TOKEN}\n`))).toBe(TOKEN)
  })

  test("trims surrounding whitespace", () => {
    expect(readHumanToken(writeTokenFile(`  ${TOKEN}  \r\n`))).toBe(TOKEN)
  })

  test("returns '' for a missing file (no throw)", () => {
    expect(readHumanToken(join(tempRoot(), "absent.token"))).toBe("")
  })

  test("returns '' when the path is a directory (unreadable, no throw)", () => {
    const dir = tempRoot()
    mkdirSync(join(dir, "human.token"))
    expect(readHumanToken(join(dir, "human.token"))).toBe("")
  })

  test("returns '' for malformed tokens", () => {
    const bad = [
      "",
      "short",
      TOKEN.slice(0, 63),
      `${TOKEN}0`,
      TOKEN.toUpperCase(),
      "z".repeat(64),
      `${TOKEN.slice(0, 63)}g`,
    ]
    for (const content of bad) {
      expect(readHumanToken(writeTokenFile(content))).toBe("")
    }
  })

  test("returns '' for binary garbage", () => {
    expect(readHumanToken(writeTokenFile("\u0000\u0001\u0002not a token"))).toBe("")
  })

  test("default path is the fixed data root file (single source of truth)", () => {
    expect(humanTokenPath()).toBe(join(homedir(), ".mafw", "human.token"))
  })

  test("MAFW_HUMAN_TOKEN_FILE overrides the path (test/dev seam)", () => {
    process.env[ENV_KEY] = join(tempRoot(), "custom.token")
    expect(humanTokenPath()).toBe(process.env[ENV_KEY]!)
    expect(humanTokenPath()).not.toBe(join(homedir(), ".mafw", "human.token"))
  })
})

// ── createGatewayClient: real SDK client + fake transport ──

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

function headersOf(call: Captured): Headers {
  return new Headers(call.init?.headers)
}

describe("createGatewayClient", () => {
  test("sends the human token read from the data-root file", async () => {
    process.env[ENV_KEY] = writeTokenFile(`${TOKEN}\n`)
    const calls: Captured[] = []
    const client = createGatewayClient("http://127.0.0.1:4321", fakeFetch(calls))

    await client.project.current()

    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe("http://127.0.0.1:4321/api/projects/current")
    expect(headersOf(calls[0]).get("x-mafw-human-token")).toBe(TOKEN)
    expect(headersOf(calls[0]).get("content-type")).toBe("application/json")
  })

  test("sends no header when the token file is missing", async () => {
    process.env[ENV_KEY] = join(tempRoot(), "absent.token")
    const calls: Captured[] = []
    const client = createGatewayClient("http://127.0.0.1:4321", fakeFetch(calls))

    await client.project.current()

    expect(headersOf(calls[0]).get("x-mafw-human-token")).toBe(null)
  })

  test("sends no header when the token file is malformed", async () => {
    process.env[ENV_KEY] = writeTokenFile("not-a-token")
    const calls: Captured[] = []
    const client = createGatewayClient("http://127.0.0.1:4321", fakeFetch(calls))

    await client.project.current()

    expect(headersOf(calls[0]).get("x-mafw-human-token")).toBe(null)
  })

  test("reads the file per construction (token rotation is picked up)", async () => {
    const file = writeTokenFile(TOKEN)
    process.env[ENV_KEY] = file
    const first: Captured[] = []
    await createGatewayClient("http://gw:3000", fakeFetch(first)).project.current()

    const rotated = "f".repeat(64)
    writeFileSync(file, rotated, "utf-8")
    const second: Captured[] = []
    await createGatewayClient("http://gw:3000", fakeFetch(second)).project.current()

    expect(headersOf(first[0]).get("x-mafw-human-token")).toBe(TOKEN)
    expect(headersOf(second[0]).get("x-mafw-human-token")).toBe(rotated)
  })
})

// ── E11-1: stale credential detection + one-shot retry ──

/** Exactly what the SDK builds for a denied human-only route. */
function staleError(): Error {
  return new Error("HTTP 403: human principal required [human_principal_required]")
}

describe("isStaleHumanTokenError", () => {
  test("true for the SDK 403 + stable code shape", () => {
    expect(isStaleHumanTokenError(staleError())).toBe(true)
  })

  test("true for 403 + code without the bracketed suffix (tolerant forms)", () => {
    expect(isStaleHumanTokenError(new Error("HTTP 403: human_principal_required"))).toBe(true)
    expect(isStaleHumanTokenError("HTTP 403 human_principal_required")).toBe(true)
  })

  test("true when the error carries a numeric 403 status", () => {
    expect(isStaleHumanTokenError(Object.assign(new Error("denied"), { status: 403, code: "human_principal_required" }))).toBe(true)
  })

  test("false for a 403 without the human code (other authorization failures)", () => {
    expect(isStaleHumanTokenError(new Error("HTTP 403: Forbidden"))).toBe(false)
    expect(isStaleHumanTokenError(new Error("HTTP 403: human principal required"))).toBe(false)
  })

  test("false for 429 / 500 / 401 (only a stale human token is retryable)", () => {
    for (const status of [401, 429, 500, 502, 503]) {
      expect(isStaleHumanTokenError(new Error(`HTTP ${status}: human_principal_required`))).toBe(false)
      expect(isStaleHumanTokenError(Object.assign(new Error("x"), { status }))).toBe(false)
    }
    // A 4030 must not be read as 403.
    expect(isStaleHumanTokenError(new Error("HTTP 4030: human_principal_required"))).toBe(false)
  })

  test("false for network / unknown values", () => {
    for (const value of [undefined, null, "", "offline", new Error("fetch failed"), { statusText: "Forbidden" }]) {
      expect(isStaleHumanTokenError(value)).toBe(false)
    }
  })
})

describe("withHumanTokenRetry", () => {
  test("retries exactly once after refreshing and returns the second result", async () => {
    let calls = 0
    let refreshes = 0
    const result = await withHumanTokenRetry(
      async () => {
        calls += 1
        if (calls === 1) throw staleError()
        return "ok"
      },
      () => { refreshes += 1 },
    )

    expect(result).toBe("ok")
    expect(calls).toBe(2)
    expect(refreshes).toBe(1)
  })

  test("awaits an async refresh before the retry (client rebuilt from disk)", async () => {
    const order: string[] = []
    const result = await withHumanTokenRetry(
      async () => {
        order.push("call")
        if (order.filter(x => x === "call").length === 1) throw staleError()
        return 42
      },
      async () => {
        order.push("refresh-start")
        await Promise.resolve()
        order.push("refresh-end")
      },
    )

    expect(result).toBe(42)
    expect(order).toEqual(["call", "refresh-start", "refresh-end", "call"])
  })

  test("propagates the second failure (no loop)", async () => {
    let calls = 0
    let refreshes = 0
    await expect(
      withHumanTokenRetry(
        async () => { calls += 1; throw staleError() },
        () => { refreshes += 1 },
      ),
    ).rejects.toThrow("human_principal_required")

    expect(calls).toBe(2)
    expect(refreshes).toBe(1)
  })

  test("does not retry non-stale failures (500 / everything else)", async () => {
    let calls = 0
    let refreshes = 0
    const boom = new Error("HTTP 500: internal error")

    await expect(
      withHumanTokenRetry(
        async () => { calls += 1; throw boom },
        () => { refreshes += 1 },
      ),
    ).rejects.toBe(boom)

    expect(calls).toBe(1)
    expect(refreshes).toBe(0)
  })

  test("a first-attempt success is untouched", async () => {
    let refreshes = 0
    const value = await withHumanTokenRetry(async () => "first", () => { refreshes += 1 })
    expect(value).toBe("first")
    expect(refreshes).toBe(0)
  })
})

// ── wiring / isolation guards ──
const MAIN_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(MAIN_DIR, "..")

test("wiring: both main-process entrypoints build clients via createGatewayClient", () => {
  for (const file of ["main/mafw-ipc.ts", "main/mafw-sidecar.ts"]) {
    const source = readFileSync(join(SRC_DIR, file), "utf-8")
    expect(source).toContain("createGatewayClient")
    // No raw construction may bypass the helper.
    expect(source).not.toMatch(/new MafwClient\(/)
  }
})

test("wiring: mafw-invoke retries once after rebuilding the client from disk", () => {
  const source = readFileSync(join(SRC_DIR, "main/mafw-ipc.ts"), "utf-8")
  expect(source).toContain("withHumanTokenRetry")
  // The refresh path must recreate the client (which re-reads the token file).
  expect(source).toMatch(/createGatewayClient\(`http:\/\/127\.0\.0\.1:\$\{port\}`\)/)
  // The retry must never print the credential.
  expect(source).not.toMatch(/console\.(log|error)\([^\n]*clientToken/)
})

test("isolation: the human credential never reaches renderer/preload/shared code", () => {
  const offenders: string[] = []
  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        out.push(...walk(full))
      } else if ([".ts", ".tsx"].includes(extname(entry)) && !entry.endsWith(".test.ts")) {
        out.push(full)
      }
    }
    return out
  }
  for (const layer of ["renderer", "preload", "shared"]) {
    for (const file of walk(join(SRC_DIR, layer))) {
      const source = readFileSync(file, "utf-8")
      if (/human-token|human\.token|X-MAFW-Human-Token|readHumanToken|createGatewayClient/.test(source)) {
        offenders.push(file)
      }
    }
  }
  expect(offenders).toEqual([])
})
