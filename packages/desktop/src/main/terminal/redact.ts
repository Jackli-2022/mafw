const SECRET_KEY = /password|passphrase|privateKey/i

/** Deep-clone a config/event object, replacing secret-looking keys. */
export function redactSshConfig(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redactSshConfig)
  if (!input || typeof input !== "object") return input
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactSshConfig(value)
  }
  return out
}

/** Keep only message/code from an error (never the full config). */
export function redactError(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as any).code
    return { message: err.message, ...(typeof code === "string" ? { code } : {}) }
  }
  return { message: String(err) }
}
