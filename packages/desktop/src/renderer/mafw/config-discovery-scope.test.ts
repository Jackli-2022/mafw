import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Regression (2026-11-03): Config → 扩展 passed the raw session directory to
// discovery.get(). Sessions whose directory is "." (legacy relative dirs) made
// the gateway reject the request with `HTTP 400: directory must be absolute`,
// so the Skills panel showed only an error. Discovery scope now follows the
// same normalized workbench root as the file tree (project dir for ordinary
// sessions, worktree dir for parallel sessions).
describe("config discovery scope wiring", () => {
  const shell = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
  const config = readFileSync(join(import.meta.dirname, "pages/Config.tsx"), "utf8")

  test("ConfigPage receives the normalized workbench root, never a raw session dir", () => {
    expect(shell).toContain("projectDir={benchRoot() ?? undefined}")
    expect(shell).not.toContain("?.directory ?? currentProject() ?? undefined")
  })

  test("discovery scope forwards the resolved project directory", () => {
    expect(config).toContain("props.projectDir ? { directory: props.projectDir } : {}")
  })
})
