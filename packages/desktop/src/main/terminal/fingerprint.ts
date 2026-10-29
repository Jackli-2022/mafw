import { createHash } from "node:crypto"

/** OpenSSH-style SHA256 fingerprint of a raw host key. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64")}`
}
