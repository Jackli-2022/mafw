import { existsSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"

/**
 * Quarantine a store file that electron-store cannot parse (construction
 * throws). Spec fail-open: a corrupt store must never brick startup — move it
 * aside (`<name>.corrupt-<ts>`) so a fresh store is created; the old bytes stay
 * for inspection. Returns the quarantine path, or null when nothing to do.
 */
export function quarantineUnreadableStore(
  cwd: string,
  name: string,
  opts: { exists?: typeof existsSync; read?: typeof readFileSync; rename?: typeof renameSync; now?: () => number } = {},
): string | null {
  const exists = opts.exists ?? existsSync
  const read = opts.read ?? readFileSync
  const rename = opts.rename ?? renameSync
  const now = opts.now ?? Date.now
  const file = join(cwd, name)
  if (!exists(file)) return null
  try {
    JSON.parse(read(file, "utf8"))
    return null
  } catch {
    const target = `${file}.corrupt-${now()}`
    rename(file, target)
    return target
  }
}
