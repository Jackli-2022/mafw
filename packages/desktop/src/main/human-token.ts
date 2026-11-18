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
 *
 * E10j-J2: `schemaEpoch: 'auto'` — the client learns the gateway's contract
 * epoch from responses and renegotiates (one 409 retry) after a gateway
 * upgrade instead of silently speaking the old contract. Raw `fetchPath`
 * calls (SSE / binary / media) stay untouched.
 */
export function createGatewayClient(baseUrl: string, fetchImpl?: typeof fetch): MafwClient {
  return new MafwClient(baseUrl, {
    clientToken: readHumanToken(),
    schemaEpoch: 'auto',
    headers: { 'x-mafw-client': 'desktop' },
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}

// ── E11-1: live reload after an out-of-band rotation ────────────────────────

/** Message text of anything the SDK may throw (Error / string / `{message}`). */
function errorText(err: unknown): string {
  if (typeof err === "string") return err
  if (err instanceof Error) return err.message
  const message = (err as { message?: unknown } | null | undefined)?.message
  return typeof message === "string" ? message : ""
}

/**
 * True only for "the gateway rejected our human credential because it was
 * rotated" — the SDK surfaces it as
 * `HTTP 403: human principal required [human_principal_required]`
 * (see `httpError()` in `@mafw/sdk`).
 *
 * Deliberately narrow: a 403 without the stable code is a different
 * authorization failure, and 429/500 are not credential problems — retrying
 * those would double side effects without fixing anything.
 */
export function isStaleHumanTokenError(err: unknown): boolean {
  const text = errorText(err)
  const explicit = (err as { status?: unknown } | null | undefined)?.status
  const status = typeof explicit === "number"
    ? explicit
    : Number((text.match(/\bHTTP\s+(\d{3})\b/) ?? text.match(/\b(\d{3})\s+Forbidden\b/))?.[1] ?? NaN)
  if (status !== 403) return false
  const code = (err as { code?: unknown } | null | undefined)?.code
  return code === "human_principal_required" || text.includes("human_principal_required")
}

/**
 * Retry a gateway call **exactly once** after `refresh` rebuilt the client.
 *
 * `call` must re-resolve the method from the live client on each invocation
 * (the stale client is already captured in its own headers). A second failure
 * is the caller's to see — a rotation loop would turn a bad credential into a
 * request storm.
 */
export async function withHumanTokenRetry<T>(
  call: () => Promise<T>,
  refresh: () => void | Promise<void>,
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!isStaleHumanTokenError(err)) throw err
    await refresh()
    return call()
  }
}
