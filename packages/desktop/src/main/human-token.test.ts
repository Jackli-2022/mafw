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
import { createGatewayClient, humanTokenPath, readHumanToken } from "./human-token"

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
