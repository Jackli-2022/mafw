// 文件树可见行（纯逻辑）：expanded 集合 + 已加载子项缓存 → 深度优先行列表。
// 懒加载语义：未加载子项的展开目录仅出目录行本身，不出子行（消费方负责拉取后重算）。
export type FsEntry = { name: string; kind: "file" | "dir" }

export interface TreeRow {
  /** 相对 root 的正斜杠路径 */
  rel: string
  name: string
  kind: "file" | "dir"
  depth: number
}

export function visibleRows(
  rootEntries: FsEntry[],
  expanded: ReadonlySet<string>,
  children: Record<string, FsEntry[]>,
): TreeRow[] {
  const out: TreeRow[] = []
  const walk = (entries: FsEntry[], base: string, depth: number) => {
    for (const e of entries) {
      const rel = base ? `${base}/${e.name}` : e.name
      out.push({ rel, name: e.name, kind: e.kind, depth })
      if (e.kind === "dir" && expanded.has(rel)) {
        const kids = children[rel]
        if (kids) walk(kids, rel, depth + 1)
      }
    }
  }
  walk(rootEntries, "", 0)
  return out
}
