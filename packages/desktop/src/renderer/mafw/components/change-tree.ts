// 变更文件平铺列表 → 可折叠目录树；以及 live 快照的脉冲 path 计算。
// 纯函数，无 Solid/DOM，node --test 可测。
import type { FileDiffEntry } from "./DiffReviewPanel"

export interface ChangeTreeNode {
  kind: "dir" | "file"
  name: string
  path: string
  additions: number
  deletions: number
  status?: string
  file?: FileDiffEntry
  children: ChangeTreeNode[]
}

export function normalizeDiffPath(file: string | undefined): string {
  const path = (file ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
  return path || "(unknown)"
}

export function buildChangeTree(files: FileDiffEntry[]): ChangeTreeNode[] {
  const roots: ChangeTreeNode[] = []
  const dirs = new Map<string, ChangeTreeNode>()

  const ensureDir = (parts: string[]): ChangeTreeNode[] => {
    let list = roots
    let path = ""
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      let dir = dirs.get(path)
      if (!dir) {
        dir = { kind: "dir", name: part, path, additions: 0, deletions: 0, children: [] }
        dirs.set(path, dir)
        list.push(dir)
      }
      list = dir.children
    }
    return list
  }

  for (const entry of files ?? []) {
    const path = normalizeDiffPath(entry.file)
    const parts = path.split("/")
    const name = parts.pop() ?? path
    const parent = ensureDir(parts)
    parent.push({
      kind: "file",
      name,
      path,
      additions: entry.additions ?? 0,
      deletions: entry.deletions ?? 0,
      status: entry.status,
      file: entry,
      children: [],
    })
  }

  const aggregate = (node: ChangeTreeNode) => {
    if (node.kind === "file") return
    for (const child of node.children) {
      aggregate(child)
      node.additions += child.additions
      node.deletions += child.deletions
    }
  }
  for (const root of roots) aggregate(root)

  const sort = (list: ChangeTreeNode[]) => {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of list) if (node.kind === "dir") sort(node.children)
  }
  sort(roots)

  return roots
}

function signature(entry: FileDiffEntry): string {
  return `${entry.additions ?? 0}|${entry.deletions ?? 0}|${entry.status ?? ""}`
}

/** prev=null 表示该会话还没有基线：返回空集（首份快照不脉冲）。 */
export function changedDiffPaths(
  prev: FileDiffEntry[] | null,
  next: FileDiffEntry[],
): Set<string> {
  const out = new Set<string>()
  if (prev == null) return out
  const before = new Map(prev.map((entry) => [normalizeDiffPath(entry.file), signature(entry)]))
  for (const entry of next ?? []) {
    const path = normalizeDiffPath(entry.file)
    if (before.get(path) !== signature(entry)) out.add(path)
  }
  return out
}

export interface PulseStep {
  seen: boolean
  prev: FileDiffEntry[]
  changed: Set<string>
}

/** 首份快照只建基线（含空数组）；之后才按 diff 产生脉冲。 */
export function nextPulseState(
  prev: FileDiffEntry[] | null,
  seen: boolean,
  live: FileDiffEntry[],
): PulseStep {
  if (!seen) return { seen: true, prev: live, changed: new Set() }
  return { seen: true, prev: live, changed: changedDiffPaths(prev, live) }
}

export function changeStatusLetter(status: string | undefined): string {
  if (!status) return ""
  const s = status.toLowerCase()
  if (s === "added" || s === "add" || s === "new") return "A"
  if (s === "deleted" || s === "delete" || s === "removed") return "D"
  if (s === "modified" || s === "modify" || s === "changed") return "M"
  return status[0]?.toUpperCase() ?? ""
}
