import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * PowerShell 5 `Set-Content -Encoding utf8` and several Windows editors write a
 * UTF-8 BOM. electron-store parses JSON with `JSON.parse`, which rejects the
 * BOM; a corrupt preference store used to abort the Desktop gateway start
 * before any error was surfaced (windowless hang). Normalise the file before
 * the store parses it.
 *
 * @returns true when the file was rewritten.
 */
export function stripStoreFileBom(cwd: string, name: string): boolean {
  const file = join(cwd, name)
  if (!existsSync(file)) return false
  const raw = readFileSync(file)
  if (raw.length < UTF8_BOM.length || !raw.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) return false
  writeFileSync(file, raw.subarray(UTF8_BOM.length))
  return true
}
