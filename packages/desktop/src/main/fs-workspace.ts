// fs-workspace：main 进程文件原语（纯逻辑 + io 注入，可单测）。
//
// 安全边界（spec Anti-goal A1 的前置）：所有 renderer 传入的相对路径必须经
// resolveInRoot jail —— 越界/绝对路径/盘符跳转一律拒绝且不抛异常。
// 平台：Windows 与 POSIX 双 OS（CI 双跑），路径归一为正斜杠 rel，落地用 path.resolve。
import { resolve as pathResolve, sep } from "node:path"
import { IGNORED_DIRS } from "./file-listing"

export interface FsEntry {
  name: string
  kind: "file" | "dir"
}

export interface FsIO {
  readdir(abs: string): Promise<{ name: string; isDirectory(): boolean }[]>
  readFile(abs: string): Promise<Buffer>
  writeFile(abs: string, data: string): Promise<void>
  stat(abs: string): Promise<{ mtimeMs: number }>
}

const DRIVE_PREFIX = /^[A-Za-z]:\//

/**
 * rel（正/反斜杠皆可）→ root 下绝对路径；越界、绝对路径、盘符跳转、空串 → null。
 * 不抛异常（renderer 传入的任何字符串都当作不可信输入）。
 */
export function resolveInRoot(root: string, rel: string): string | null {
  if (typeof rel !== "string") return null
  const norm = rel.replace(/\\/g, "/").trim()
  if (norm === "" || norm.startsWith("/") || DRIVE_PREFIX.test(norm)) return null
  const resolved = pathResolve(root, norm)
  // 前缀守卫：Windows 大小写不敏感
  const base = pathResolve(root)
  const cmpResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved
  const cmpBase = process.platform === "win32" ? base.toLowerCase() : base
  if (!cmpResolved.startsWith(cmpBase + sep) && cmpResolved !== cmpBase) return null
  return resolved
}

/** 单层列举整形：目录在前、名称排序；IGNORED_DIRS 与隐藏项过滤（.mafw 例外）。 */
export function shapeEntries(entries: { name: string; isDirectory(): boolean }[]): FsEntry[] {
  const out: FsEntry[] = []
  for (const e of entries) {
    if (!e?.name) continue
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue
      if (e.name.startsWith(".") && e.name !== ".mafw") continue
      out.push({ name: e.name, kind: "dir" })
    } else {
      if (e.name.startsWith(".") && e.name !== ".mafw") continue
      out.push({ name: e.name, kind: "file" })
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1))
}

export const MAX_READ_BYTES = 1_048_576

/** 前 512 字节含 NUL → 视为二进制。 */
export function sniffBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 512)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

export type ReadResult =
  | { ok: true; content: string; mtimeMs: number }
  | { ok: false; reason: "too-large" | "binary" | "not-found" | "io" }

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "jail" | "not-found" | "conflict" | "io" }

function isNotFound(e: unknown): boolean {
  return (e as any)?.code === "ENOENT"
}

/** 单层列目录；rel="" 为 root 自身。jail 外或不可读 → null。 */
export async function listDir(io: FsIO, root: string, rel: string): Promise<FsEntry[] | null> {
  const abs = rel === "" ? pathResolve(root) : resolveInRoot(root, rel)
  if (!abs) return null
  try {
    return shapeEntries(await io.readdir(abs))
  } catch {
    return null
  }
}

export async function readTextFile(io: FsIO, root: string, rel: string): Promise<ReadResult> {
  const abs = resolveInRoot(root, rel)
  if (!abs) return { ok: false, reason: "not-found" } // 不向 renderer 泄露越界细节
  let buf: Buffer
  let stat: { mtimeMs: number }
  try {
    buf = await io.readFile(abs)
    stat = await io.stat(abs)
  } catch (e) {
    return { ok: false, reason: isNotFound(e) ? "not-found" : "io" }
  }
  if (buf.length > MAX_READ_BYTES) return { ok: false, reason: "too-large" }
  if (sniffBinary(buf)) return { ok: false, reason: "binary" }
  return { ok: true, content: buf.toString("utf8"), mtimeMs: stat.mtimeMs }
}

/**
 * 覆盖写已存在文件；不创建新文件（防 agent 诱导写任意新路径）。
 * ifMtimeMs 提供时先 stat 比对：磁盘 mtime 不同 → conflict（不覆盖）——
 * 保存时版本校验，补死 watch 防抖窗口内的静默覆盖（调研 §3 防线②）。
 */
export async function writeTextFile(
  io: FsIO,
  root: string,
  rel: string,
  content: string,
  opts?: { ifMtimeMs?: number },
): Promise<WriteResult> {
  const abs = resolveInRoot(root, rel)
  if (!abs) return { ok: false, reason: "jail" }
  let stat: { mtimeMs: number }
  try {
    stat = await io.stat(abs)
  } catch (e) {
    return { ok: false, reason: isNotFound(e) ? "not-found" : "io" }
  }
  if (typeof opts?.ifMtimeMs === "number" && stat.mtimeMs !== opts.ifMtimeMs) {
    return { ok: false, reason: "conflict" }
  }
  try {
    await io.writeFile(abs, content)
    return { ok: true }
  } catch {
    return { ok: false, reason: "io" }
  }
}
