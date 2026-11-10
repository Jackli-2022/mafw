import * as os from "node:os"
import * as path from "node:path"

export const GATEWAY_DISCOVERY_FILE = "gateway.json"

/**
 * Coordination files live next to the data directory, not inside it:
 * `~/.mafw/runtime`. Tests and CI can override this with `MAFW_RUNTIME_DIR`;
 * production always resolves to the same path for every client.
 */
export function mafwRuntimeDir(
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.MAFW_RUNTIME_DIR?.trim()
  return override || path.join(homeDir, ".mafw", "runtime")
}
