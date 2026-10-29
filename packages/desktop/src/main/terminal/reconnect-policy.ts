// Auto-reconnect policy (spec 2026-10-29 §6.6).
import type { SshHostProfile } from "../../shared/ssh-host"

export const MAX_RECONNECT_ATTEMPTS = 5

/** 1/2/4/8/16s; null means stop. */
export function reconnectDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RECONNECT_ATTEMPTS) return null
  return 1000 * 2 ** (attempt - 1)
}

export function canAutoReconnect(input: {
  profile: Pick<SshHostProfile, "auth" | "autoReconnect">
  hasPassword: boolean
  hasPassphrase: boolean
  hasKey: boolean
  agentAvailable: boolean
}): boolean {
  if (!input.profile.autoReconnect) return false
  switch (input.profile.auth) {
    case "password":
      return input.hasPassword
    case "key":
      return input.hasKey
    case "agent":
      return input.agentAvailable
    default:
      return false
  }
}
