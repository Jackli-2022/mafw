// Whole-file content fingerprint for annotation provenance and target checks.
// Pure IO injection keeps the jail/limit behavior testable without Electron.
import { createHash } from "node:crypto"
import { resolveInRoot } from "./fs-workspace"

const MAX_VERSION_BYTES = 32 * 1024 * 1024

export interface FsVersionIO {
  stat(abs: string): Promise<{ size: number; mtimeMs: number }>
  readFile(abs: string): Promise<Buffer>
}

export type FsVersionResult =
  | { ok: true; sha256: string; size: number; mtimeMs: number }
  | { ok: false; reason: "jail" | "not-found" | "too-large" | "io" }

export async function versionFile(io: FsVersionIO, root: string, rel: string): Promise<FsVersionResult> {
  const abs = resolveInRoot(root, rel)
  if (!abs) return { ok: false, reason: "jail" }
  try {
    const stat = await io.stat(abs)
    if (stat.size > MAX_VERSION_BYTES) return { ok: false, reason: "too-large" }
    const bytes = await io.readFile(abs)
    return {
      ok: true,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    }
  } catch (err: any) {
    return { ok: false, reason: err?.code === "ENOENT" ? "not-found" : "io" }
  }
}
