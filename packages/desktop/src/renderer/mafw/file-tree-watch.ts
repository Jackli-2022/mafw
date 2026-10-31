// 文件树目录 watch 纯逻辑（2026-10-31）：
// 只 watch「根 + 当前展开的目录」——折叠子树不显示，不必监听；
// 差分保证幂等（展开/收起/root 切换时不重复注册或退订）。

export type DirWatchPlan = { add: string[]; remove: string[] }

/** current=已注册的 rel 集合；wanted=期望集合（调用方保证含 ""）。 */
export function planDirWatches(
  current: ReadonlySet<string>,
  wanted: Iterable<string>,
): DirWatchPlan {
  const add: string[] = []
  const keep = new Set<string>()
  for (const rel of wanted) {
    keep.add(rel)
    if (!current.has(rel)) add.push(rel)
  }
  const remove: string[] = []
  for (const rel of current) if (!keep.has(rel)) remove.push(rel)
  return { add, remove }
}

/** 目录刷新结果合并：entries=null 表示目录已消失 → 删缓存（无变化时返回原对象）。 */
export function nextChildrenAfterRefresh<T>(
  prev: Record<string, T[]>,
  rel: string,
  entries: T[] | null,
): Record<string, T[]> {
  if (entries === null) {
    if (!(rel in prev)) return prev
    const next = { ...prev }
    delete next[rel]
    return next
  }
  return { ...prev, [rel]: entries }
}

/** 文件树条目深比较：等值时保持引用稳定，避免 <For> 整行重挂（事件风暴下会闪）。 */
export function sameDirEntries(
  a: ReadonlyArray<{ name: string; kind?: string }>,
  b: ReadonlyArray<{ name: string; kind?: string }>,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.name !== b[i]!.name || a[i]!.kind !== b[i]!.kind) return false
  }
  return true
}
