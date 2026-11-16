/**
 * E5a-4: read the human token from the fixed data root (`~/.mafw/human.token`)
 * and build the TUI gateway client that carries it.
 *
 * The TUI is a human surface: it injects the token into the SDK client so the
 * gateway can authorise human-only actions. Missing/unreadable/malformed file →
 * '' (fail-closed); human-only actions then surface the gateway's 403.
 *
 * `MAFW_HUMAN_TOKEN_FILE` overrides the file path — a test/dev seam so a temp
 * token can be exercised without touching the real data root.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MafwClient } from '@mafw/sdk'

/** 32 random bytes as lowercase hex (mirrors gateway/src/core/human-token.ts). */
const HUMAN_TOKEN_RE = /^[0-9a-f]{64}$/

export function humanTokenPath(): string {
  return process.env.MAFW_HUMAN_TOKEN_FILE || join(homedir(), '.mafw', 'human.token')
}

export function readHumanToken(filePath: string = humanTokenPath()): string {
  try {
    const token = readFileSync(filePath, 'utf-8').trim()
    return HUMAN_TOKEN_RE.test(token) ? token : ''
  } catch {
    return ''
  }
}

/**
 * Single entrypoint for the TUI gateway client (base URL + human token).
 *
 * E10j-J2: `schemaEpoch: 'auto'` mirrors the desktop main process — the client
 * learns the gateway's contract epoch and renegotiates once after an upgrade.
 */
export function createTuiClient(baseUrl: string, fetchImpl?: typeof fetch): MafwClient {
  return new MafwClient(baseUrl, {
    clientToken: readHumanToken(),
    schemaEpoch: 'auto',
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}
