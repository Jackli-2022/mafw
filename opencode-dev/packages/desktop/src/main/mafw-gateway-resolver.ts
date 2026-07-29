import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export function resolveGatewayEntry(): string | null {
  if (process.env.MAFW_GATEWAY_ENTRY) {
    const entry = process.env.MAFW_GATEWAY_ENTRY
    if (existsSync(entry)) return entry
  }

  const candidates: string[] = [
    join(homedir(), ".mafw", "gateway", "dist", "gateway", "src", "index.js"),
  ]

  try {
    const localPlugin = require.resolve("mafw-plugin/package.json")
    candidates.push(join(localPlugin, "..", "..", "gateway", "dist", "gateway", "src", "index.js"))
  } catch {}

  if (process.env.MAFW_DIR) {
    candidates.push(join(process.env.MAFW_DIR, "gateway", "dist", "gateway", "src", "index.js"))
  }

  if (process.env.OPENCODE_PROJECT_ROOT) {
    candidates.push(
      join(process.env.OPENCODE_PROJECT_ROOT, "gateway", "dist", "gateway", "src", "index.js"),
    )
  }

  // Development: check relative to the module (works for both bun test and electron bundle)
  try {
    const dir = fileURLToPath(new URL(".", import.meta.url))
    candidates.push(join(dir, "..", "..", "..", "..", "..", "gateway", "dist", "gateway", "src", "index.js"))
  } catch {}

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return null
}
