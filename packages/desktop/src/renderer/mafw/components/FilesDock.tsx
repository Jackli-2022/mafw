// FilesDock：工作台文件树 —— 当前会话目录的懒加载树（只读导航）。
// 语义（spec §5.1）：只读导航（不建/删/改），目录懒加载（不递归预取）；
// 文件点击 → 交给编辑器打开（onOpenFile）。root 跟随活动会话 directory。
// 骨架（spec 2026-10-26）：DockPanelHeader 统一头 + DockEmpty/DockBanner 空/错态，
// 图标走 @mafw/ui/icon（禁 emoji/几何字形）。
import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { visibleRows, type FsEntry, type TreeRow } from "../file-tree"
import { nextChildrenAfterRefresh, planDirWatches, sameDirEntries } from "../file-tree-watch"
import { menuController } from "../context-menu/controller"
import { buildFileTreeMenu } from "../context-menu/builders/file-tree"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { pushComposerInsert } from "../composer-insert"
import { openMenuOnKey } from "../context-menu/menu-key"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"

export function FilesDock(props: {
  sessionDirectory: string | null
  sessionID?: string | null
  onOpenFile: (rel: string) => void
}) {
  const [rootEntries, setRootEntries] = createSignal<FsEntry[]>([])
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [children, setChildren] = createSignal<Record<string, FsEntry[]>>({})
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  /** root 加载代际：重试/切目录时丢弃迟到结果。 */
  let loadToken = 0

  const loadRoot = () => {
    const root = props.sessionDirectory
    const token = ++loadToken
    setExpanded(new Set<string>())
    setChildren({})
    setRootEntries([])
    setError(null)
    if (!root) { setLoading(false); return }
    setLoading(true)
    window.api.fs.listDir(root, "")
      .then(entries => { if (token === loadToken) setRootEntries(entries ?? []) })
      .catch((e: any) => {
        if (token === loadToken) setError(`读取目录失败：${String(e?.message ?? e).slice(0, 60)}`)
      })
      .finally(() => { if (token === loadToken) setLoading(false) })
  }

  // root 变化（切会话/切 worktree）→ 整树重置（Review Focus #4）
  createEffect(() => {
    props.sessionDirectory
    releaseWatches()
    loadRoot()
  })

  // ── 目录自动刷新（2026-10-31）：watch 根 + 当前展开目录 ─────────────
  // 折叠子树不显示，不监听；事件只重列受影响目录，不整树重置（防闪烁/丢展开态）。
  const watched = new Map<string, string>() // rel → root（root 切换时按记录退订）

  function releaseWatches() {
    for (const [rel, root] of [...watched]) {
      watched.delete(rel)
      void window.api.fs.unwatchDir?.(root, rel)
    }
  }

  function syncWatches() {
    const root = props.sessionDirectory
    // 换 root 后旧 watch 一律退订（按注册时的 root，不按新 root）
    for (const [rel, r] of [...watched]) {
      if (!root || r !== root) {
        watched.delete(rel)
        void window.api.fs.unwatchDir?.(r, rel)
      }
    }
    const wanted = new Set<string>()
    if (!root) return
    wanted.add("")
    for (const rel of expanded()) wanted.add(rel)
    const plan = planDirWatches(new Set(watched.keys()), wanted)
    for (const rel of plan.remove) {
      watched.delete(rel)
      void window.api.fs.unwatchDir?.(root, rel)
    }
    for (const rel of plan.add) {
      watched.set(rel, root)
      void window.api.fs.watchDir?.(root, rel)
    }
  }

  createEffect(() => {
    props.sessionDirectory
    expanded()
    syncWatches()
  })

  async function refreshDir(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    const entries = await window.api.fs.listDir(root, rel)
    if (root !== props.sessionDirectory) return
    if (rel === "") {
      if (entries) setRootEntries(prev => sameDirEntries(prev, entries) ? prev : entries)
      return
    }
    setChildren(prev => {
      const before = prev[rel]
      if (entries && before && sameDirEntries(before, entries)) return prev
      return nextChildrenAfterRefresh(prev, rel, entries)
    })
    if (entries === null) {
      // 目录已被删除/移动：收起并退订
      setExpanded(prev => {
        if (!prev.has(rel)) return prev
        const next = new Set(prev)
        next.delete(rel)
        return next
      })
      const watchedRoot = watched.get(rel)
      if (watchedRoot) {
        watched.delete(rel)
        void window.api.fs.unwatchDir?.(watchedRoot, rel)
      }
    }
  }

  onMount(() => {
    // 旧 preload（未重启 Electron）没有 onDirChanged：静默降级为手动刷新。
    const off = window.api.fs.onDirChanged?.(({ root, rel }) => {
      if (root !== props.sessionDirectory) return
      void refreshDir(rel)
    })
    onCleanup(() => {
      off?.()
      releaseWatches()
    })
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
          setError("无法读取该目录")
          return
        }
        setChildren(prev => ({ ...prev, [row.rel]: entries }))
      } catch (e: any) {
        if (root !== props.sessionDirectory) return
        setError(`读取目录失败：${String(e?.message ?? e).slice(0, 60)}`)
        return
      }
    }
    setExpanded(new Set([...expanded(), row.rel]))
  }

  const activate = (row: TreeRow) => {
    if (row.kind === "dir") void toggleDir(row)
    else props.onOpenFile(row.rel)
  }

  const absPath = (rel: string) => {
    const root = (props.sessionDirectory ?? "").replace(/[\\/]+$/, "")
    return `${root}/${rel.replace(/^[\\/]+/, "")}`
  }

  const requestRowMenu = (row: TreeRow, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    const abs = absPath(row.rel)
    const name = row.rel.split(/[\\/]/).pop() ?? row.rel
    menuController.request(
      buildFileTreeMenu,
      { rel: row.rel, kind: row.kind, previewable: row.kind === "file" },
      (id) => {
        if (id === "fileTree.open" || id === "fileTree.preview") activate(row)
        else if (id === "fileTree.attach") pushComposerInsert(props.sessionID ?? "", `@${row.rel}`)
        else if (id === "fileTree.reveal") void window.api.revealPath(abs)
        else if (id === "fileTree.copy.rel") void navigator.clipboard.writeText(row.rel)
        else if (id === "fileTree.copy.abs") void navigator.clipboard.writeText(abs)
        else if (id === "fileTree.copy.name") void navigator.clipboard.writeText(name)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <div class="mafw-files-panel">
      <DockPanelHeader title="文件">
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="刷新文件树"
            disabled={!props.sessionDirectory || loading()}
            onClick={() => loadRoot()}
          >
            <Icon name="refresh" size="small" />
          </ButtonV2>
        </TooltipV2>
      </DockPanelHeader>
      <Show when={error()}>
        <DockBanner kind="error" text={error()!} action={{ label: "重试", onClick: () => loadRoot() }} />
      </Show>
      <div class="mafw-file-tree">
        <Show
          when={props.sessionDirectory}
          fallback={<DockEmpty icon="file-tree" text="没有打开的会话" hint="打开会话后此处显示项目文件" />}
        >
          <Show when={loading()}>
            <DockBanner kind="info" busy text="加载中…" />
          </Show>
          <Show when={!loading() && !error() && rows().length === 0}>
            <DockEmpty icon="file-tree" text="目录为空" hint="可能被忽略规则过滤" />
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
                onContextMenu={(event) => requestRowMenu(row, event)}
                onKeyDown={(e: KeyboardEvent) => {
                  openMenuOnKey(e)
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(row) }
                }}
              >
                <span class="mafw-file-tree-icon">
                  <Icon
                    name={row.kind === "dir" ? (expanded().has(row.rel) ? "chevron-down" : "chevron-right") : "file"}
                    size="small"
                  />
                </span>
                <span class="mafw-file-tree-name">{row.name}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
