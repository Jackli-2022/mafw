// E5a-4 wiring guard (spec §5.2): every main-process MafwClient is constructed
// with the human token, and the credential never reaches renderer/preload code.
import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const MAIN_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(MAIN_DIR, "..")
const CALL_WINDOW = 160

function readSource(relFromSrc: string): string {
  return readFileSync(join(SRC_DIR, relFromSrc), "utf-8")
}

function clientCallSites(source: string): string[] {
  const sites: string[] = []
  const pattern = /new MafwClient\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    sites.push(source.slice(match.index, match.index + CALL_WINDOW))
  }
  return sites
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if ([".ts", ".tsx"].includes(extname(entry)) && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

for (const file of ["main/mafw-ipc.ts", "main/mafw-sidecar.ts"]) {
  test(`wiring: ${file} passes clientToken to every MafwClient`, () => {
    const source = readSource(file)
    const sites = clientCallSites(source)
    expect(sites.length).toBeGreaterThan(0)
    for (const site of sites) {
      expect(site).toContain("clientToken: readHumanToken()")
    }
    expect(source).toMatch(/from "\.\/human-token"/)
  })
}

test("wiring: the human credential never reaches renderer/preload/shared code", () => {
  const offenders: string[] = []
  for (const layer of ["renderer", "preload", "shared"]) {
    for (const file of sourceFiles(join(SRC_DIR, layer))) {
      const source = readFileSync(file, "utf-8")
      if (/human-token|human\.token|X-MAFW-Human-Token|readHumanToken/.test(source)) offenders.push(file)
    }
  }
  expect(offenders).toEqual([])
})
