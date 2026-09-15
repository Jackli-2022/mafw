import { join } from "node:path"
import { homedir } from "node:os"

// Desktop-side trigger for the gateway self-update flow: writes the
// pending-restart.json token that the gateway polls (gateway/src/self-update.ts).
// Pure token building + injected-IO atomic write keep this testable.

export type PendingRestartToken = {
  target: "gateway"
  action: "update" | "restart"
  reason?: string
  requestedAt: number
}

export function buildUpdateToken(reason: string, version?: string): PendingRestartToken {
  return {
    target: "gateway",
    action: "update",
    reason: version ? `${reason}（desktop v${version}）` : reason,
    requestedAt: Date.now(),
  }
}

export function pendingRestartPath(): string {
  return join(homedir(), ".mafw", "pending-restart.json")
}

export type TokenIo = {
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export async function atomicWriteToken(
  path: string,
  token: PendingRestartToken,
  io: TokenIo,
): Promise<void> {
  const tmp = `${path}.tmp`
  await io.writeFile(tmp, JSON.stringify(token, null, 2))
  await io.rename(tmp, path)
}
