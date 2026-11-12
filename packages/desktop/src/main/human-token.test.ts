// E5a-4: the desktop main process reads the human token from the data root.
// Spec §5.2 — read `~/.mafw/human.token`, trim, validate, never throw, never log.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { humanTokenPath, readHumanToken } from "./human-token"

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

afterEach(() => {
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
})
