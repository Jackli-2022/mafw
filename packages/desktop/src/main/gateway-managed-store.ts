import { readFileSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type ManagedPointer = {
  version: string
  payloadManifestSha256: string
  versionDir: string
  installedAt: string
}

export type QuarantineRecord = {
  version: string
  payloadManifestSha256: string
  error: string
  failedAt: string
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function hash(value: unknown): string | null {
  const parsed = text(value)
  return parsed && /^[a-f0-9]{64}$/i.test(parsed) ? parsed.toLowerCase() : null
}

function parsePointer(value: unknown): ManagedPointer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const version = text(raw.version)
  const payloadManifestSha256 = hash(raw.payloadManifestSha256)
  const versionDir = text(raw.versionDir)
  const installedAt = text(raw.installedAt)
  if (!version || !payloadManifestSha256 || !versionDir || !installedAt) return null
  if (/[\\/]/.test(versionDir)) return null
  return { version, payloadManifestSha256, versionDir, installedAt }
}

function parseQuarantine(value: unknown): QuarantineRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const version = text(raw.version)
  const payloadManifestSha256 = hash(raw.payloadManifestSha256)
  const error = text(raw.error)
  const failedAt = text(raw.failedAt)
  if (!version || !payloadManifestSha256 || !error || !failedAt) return null
  return { version, payloadManifestSha256, error, failedAt }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  try {
    await rename(temp, file)
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  }
}

export function readCurrentPointer(root: string): ManagedPointer | null {
  return parsePointer(readJson(join(root, "current.json")))
}

export async function writeCurrentPointer(root: string, pointer: ManagedPointer): Promise<void> {
  await writeJsonAtomic(join(root, "current.json"), pointer)
}

export function readPreviousPointer(root: string): ManagedPointer | null {
  return parsePointer(readJson(join(root, "previous.json")))
}

export async function moveCurrentToPrevious(root: string): Promise<void> {
  const current = readCurrentPointer(root)
  if (!current) return
  await writeJsonAtomic(join(root, "previous.json"), current)
  await rm(join(root, "current.json"), { force: true })
}

export function readQuarantine(root: string): QuarantineRecord | null {
  return parseQuarantine(readJson(join(root, "quarantine.json")))
}

export async function writeQuarantine(root: string, record: QuarantineRecord): Promise<void> {
  await writeJsonAtomic(join(root, "quarantine.json"), record)
}

export async function clearQuarantine(root: string): Promise<void> {
  await rm(join(root, "quarantine.json"), { force: true })
}
