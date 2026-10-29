// Small JSON file helpers for terminal persistence (atomic writes, fail-open reads).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T
  } catch {
    return fallback
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8")
  try {
    renameSync(tmp, filePath)
  } catch {
    // Windows can refuse rename-over-existing in some environments; fall back.
    try { rmSync(filePath, { force: true }) } catch { /* ignore */ }
    renameSync(tmp, filePath)
  }
}
