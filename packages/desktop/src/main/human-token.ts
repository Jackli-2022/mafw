/**
 * E5a-4: read the human token from the fixed data root (`~/.mafw/human.token`)
 * and build the gateway client that carries it.
 *
 * This module is main-process only — the credential is injected into the SDK
 * client (`X-MAFW-Human-Token`) and must never be handed to the renderer,
 * preload bridge, plugin web views or the logs.
 *
 * Failure is not an error: a missing/unreadable/malformed file yields '' and
 * human-only actions simply surface the gateway's 403 (fail-closed).
 *
 * `MAFW_HUMAN_TOKEN_FILE` overrides the file path. It exists so tests (and
 * isolated dev runs) can point at a temp token without touching the real data
 * root; production always uses the fixed path.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { MafwClient } from "@mafw/sdk"

/** 32 random bytes as lowercase hex (mirrors gateway/src/core/human-token.ts). */
const HUMAN_TOKEN_RE = /^[0-9a-f]{64}$/

export function humanTokenPath(): string {
  return process.env.MAFW_HUMAN_TOKEN_FILE || join(homedir(), ".mafw", "human.token")
}

export function readHumanToken(filePath: string = humanTokenPath()): string {
  try {
    const token = readFileSync(filePath, "utf-8").trim()
    return HUMAN_TOKEN_RE.test(token) ? token : ""
  } catch {
    return ""
  }
}

/**
 * Single entrypoint for every desktop gateway client: base URL + the human
 * credential (+ injectable fetch for probes/tests).
 */
export function createGatewayClient(baseUrl: string, fetchImpl?: typeof fetch): MafwClient {
  return new MafwClient(baseUrl, {
    clientToken: readHumanToken(),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}
