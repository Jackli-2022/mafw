import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { parsePatch } from "diff"
import type { MafwDiff, MafwDiffStatus } from "@mafw/sdk"

/** 审阅 diff 的读入形状：MAFW diff 视图 + 可选的整文件前后内容。 */
export type ReviewDiffSource = MafwDiff & {
  before?: string
  after?: string
}

export type DiffSource = Pick<ReviewDiffSource, "file" | "patch" | "before" | "after">

/** 渲染层的三态变更（MAFW 的 renamed/unknown 在展示上折叠）。 */
export type ViewDiffStatus = "added" | "deleted" | "modified"

export type ViewDiff = {
  file: string
  additions: number
  deletions: number
  status?: ViewDiffStatus
  fileDiff: FileDiffMetadata
}

const diffCacheLimit = 16
const patchFileDiffCache = new Map<string, FileDiffMetadata>()

export function resolveFileDiff(diff: DiffSource) {
  if (typeof diff.patch === "string") return fileDiffFromPatch(diff.file, diff.patch)
  return fileDiffFromContent(
    diff.file,
    typeof diff.before === "string" ? diff.before : "",
    typeof diff.after === "string" ? diff.after : "",
  )
}

function viewStatus(status: MafwDiffStatus | undefined): ViewDiffStatus | undefined {
  if (status === "added" || status === "deleted" || status === "modified") return status
  if (status === "renamed") return "modified"
  return undefined
}

export function normalize(diff: ReviewDiffSource): ViewDiff {
  return {
    file: diff.file,
    additions: diff.additions ?? 0,
    deletions: diff.deletions ?? 0,
    status: viewStatus(diff.status),
    fileDiff: resolveFileDiff(diff),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}

function fileDiffFromPatch(file: string, patch: string) {
  const key = `${file}\0${patch}`
  const hit = patchFileDiffCache.get(key)
  if (hit) {
    patchFileDiffCache.delete(key)
    patchFileDiffCache.set(key, hit)
    return hit
  }

  const contents = completePatchContents(patch)
  const input = contents ? undefined : patchInput(file, patch)
  const value = contents
    ? fileDiffFromContent(file, contents.before, contents.after)
    : ((input ? parsePatchFiles(input)[0]?.files[0] : undefined) ?? emptyFileDiff(file))
  patchFileDiffCache.set(key, value)
  while (patchFileDiffCache.size > diffCacheLimit) patchFileDiffCache.delete(patchFileDiffCache.keys().next().value!)
  return value
}

function completePatchContents(patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed || (!parsed.index && !parsed.oldFileName && !parsed.newFileName)) return
    // Snapshot and VCS producers request full context. Tool patches use jsdiff's shorter default context.
    if (!patch.startsWith("diff --git ") && !/^--- [^\n]*\t\r?\n\+\+\+ [^\n]*\t(?:\r?\n|$)/m.test(patch)) return
    // Full patches collapse into one leading hunk. Separated hunks omit ranges and must stay partial.
    if (parsed.hunks.length !== 1) return

    const hunk = parsed.hunks[0]
    if (!hunk || hunk.oldStart > 1 || hunk.newStart > 1) return

    const before: Array<{ text: string; newline: boolean }> = []
    const after: Array<{ text: string; newline: boolean }> = []
    let previous: "-" | "+" | " " | undefined

    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        if (previous === "-" || previous === " ") {
          const value = before.at(-1)
          if (value) value.newline = false
        }
        if (previous === "+" || previous === " ") {
          const value = after.at(-1)
          if (value) value.newline = false
        }
        continue
      }
      if (line.startsWith("-")) {
        before.push({ text: line.slice(1), newline: true })
        previous = "-"
        continue
      }
      if (line.startsWith("+")) {
        after.push({ text: line.slice(1), newline: true })
        previous = "+"
        continue
      }
      if (!line.startsWith(" ")) return
      before.push({ text: line.slice(1), newline: true })
      after.push({ text: line.slice(1), newline: true })
      previous = " "
    }

    const text = (lines: Array<{ text: string; newline: boolean }>) =>
      lines.map((line) => line.text + (line.newline ? "\n" : "")).join("")
    return { before: text(before), after: text(after) }
  } catch {
    return
  }
}

function patchInput(file: string, patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed) return
    if (parsed.index || parsed.oldFileName || parsed.newFileName) return patch
    if (!parsed.hunks.length) return
    return `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n${patch}`
  } catch {
    return
  }
}

function fileDiffFromContent(file: string, before: string, after: string) {
  if (!before && !after) return emptyFileDiff(file)
  return parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
}

function emptyFileDiff(file: string) {
  return parseDiffFromFile({ name: file, contents: "" }, { name: file, contents: "" })
}
