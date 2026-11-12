/**
 * E5a-4: read the human token from the fixed data root (`~/.mafw/human.token`).
 *
 * The TUI is a human surface: it injects the token into the SDK client so the
 * gateway can authorise human-only actions. Missing/unreadable/malformed file →
 * '' (fail-closed); human-only actions then surface the gateway's 403.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 32 random bytes as lowercase hex (mirrors gateway/src/core/human-token.ts). */
const HUMAN_TOKEN_RE = /^[0-9a-f]{64}$/

export function humanTokenPath(): string {
  return join(homedir(), '.mafw', 'human.token')
}

export function readHumanToken(filePath: string = humanTokenPath()): string {
  try {
    const token = readFileSync(filePath, 'utf-8').trim()
    return HUMAN_TOKEN_RE.test(token) ? token : ''
  } catch {
    return ''
  }
}
