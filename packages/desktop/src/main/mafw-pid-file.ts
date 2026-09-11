import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/** Same location the mafw CLI and gateway takeover write, so status/stop work. */
export function gatewayPidFilePath(configDir = join(homedir(), ".config", "mafw")): string {
  return join(configDir, "gateway.pid")
}

export async function writeGatewayPidFile(pid: number, filePath = gatewayPidFilePath()): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, String(pid), "utf-8")
}

/** Removes the pid file only if it still points at our pid (a takeover or CLI
 * daemon may have taken ownership meanwhile). */
export async function clearGatewayPidFile(pid: number, filePath = gatewayPidFilePath()): Promise<boolean> {
  try {
    const current = (await fs.readFile(filePath, "utf-8")).trim()
    if (current !== String(pid)) return false
    await fs.unlink(filePath)
    return true
  } catch {
    return false
  }
}
