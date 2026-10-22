// FilesDock：RightDock「文件」tab —— 当前会话目录的懒加载文件树。
// 语义（spec §5.1）：只读导航（不建/删/改），目录懒加载（不递归预取）；
// 文件点击 → 交给编辑器打开（onOpenFile）。root 跟随活动会话 directory。
import { createSignal, createEffect, For, Show } from "solid-js"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { visibleRows, type FsEntry, type TreeRow } from "../file-tree"

export function FilesDock(props: {
  sessionDirectory: string | null
  onOpenFile: (rel: string) => void
}) {
  const [rootEntries, setRootEntries] = createSignal<FsEntry[]>([])
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [children, setChildren] = createSignal<Record<string, FsEntry[]>>({})
  const [loading, setLoading] = createSignal(false)

  // root 变化（切会话/切 worktree）→ 整树重置（Review Focus #4）
  createEffect(() => {
    const root = props.sessionDirectory
    setExpanded(new Set<string>())
    setChildren({})
    setRootEntries([])
    if (!root) return
    let cancelled = false
    setLoading(true)
    window.api.fs.listDir(root, "")
      .then(entries => { if (!cancelled) setRootEntries(entries ?? []) })
      .catch((e: any) => {
        if (!cancelled) showToastV2({ description: `读取目录失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  })

  const rows = () => visibleRows(rootEntries(), expanded(), children())

  const toggleDir = async (row: TreeRow) => {
    const root = props.sessionDirectory
    if (!root) return
    const exp = expanded()
    if (exp.has(row.rel)) {
      const next = new Set(exp)
      next.delete(row.rel)
      setExpanded(next)
      return
    }
    if (!children()[row.rel]) {
      try {
        const entries = await window.api.fs.listDir(root, row.rel)
        // root 已切换：丢弃迟到结果（终审 Important 2 同类）
        if (root !== props.sessionDirectory) return
        if (entries === null) {
          showToastV2({ description: "无法读取该目录", variant: "error", duration: 2000 } as any)
          return
        }
        setChildren(prev => ({ ...prev, [row.rel]: entries }))
      } catch (e: any) {
        showToastV2({ description: `读取目录失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
        return
      }
    }
    setExpanded(new Set([...expanded(), row.rel]))
  }

  const activate = (row: TreeRow) => {
    if (row.kind === "dir") void toggleDir(row)
    else props.onOpenFile(row.rel)
  }

  return (
    <div class="mafw-file-tree">
      <Show
        when={props.sessionDirectory}
        fallback={<div class="mafw-file-tree-empty">没有打开的会话</div>}
      >
        <Show when={loading()}>
          <div class="mafw-file-tree-loading">加载中…</div>
        </Show>
        <Show when={!loading() && rows().length === 0}>
          <div class="mafw-file-tree-empty">目录为空（或被忽略规则过滤）</div>
        </Show>
        <For each={rows()}>
          {(row) => (
            <div
              class="mafw-file-tree-row"
              classList={{ "mafw-file-tree-row-dir": row.kind === "dir" }}
              style={{ "padding-left": `${8 + row.depth * 14}px` }}
              role="button"
              tabIndex={0}
              title={row.rel}
              onClick={() => activate(row)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(row) }
              }}
            >
              <span class="mafw-file-tree-icon">
                {row.kind === "dir" ? (expanded().has(row.rel) ? "▾" : "▸") : "📄"}
              </span>
              <span class="mafw-file-tree-name">{row.name}</span>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
