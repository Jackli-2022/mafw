// FilesDock：工作台文件树 —— 当前会话目录的懒加载树（只读导航）。
// 语义（spec §5.1）：只读导航（不建/删/改），目录懒加载（不递归预取）；
// 文件点击 → 交给编辑器打开（onOpenFile）。root 跟随活动会话 directory。
// 骨架（spec 2026-10-26）：DockPanelHeader 统一头 + DockEmpty/DockBanner 空/错态，
// 图标走 @mafw/ui/icon（禁 emoji/几何字形）。
import { createSignal, createEffect, onMount, onCleanup, For, Show, type JSX } from "solid-js"
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
import {
  contentScopeStateFor,
  onContentScopeStateChange,
  saveContentScopeState,
  selectTreeFile,
  setTreeExpanded,
  type ContentScopeState,
} from "../content-scope-state"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"
import { acquireDirWatch } from "../dir-watch-pool"

export function FilesDock(props: {
  contentRoot: string | null
  scopeKey?: string | null
  sessionID?: string | null
  title?: string
  headerAction?: JSX.Element
  /** 嵌入左 dock 时由项目头承担标题，隐藏面板自带的「文件」头。 */
  showHeader?: boolean
  /** 左 dock 头部的手动刷新信号；每次递增触发一次根目录重载。 */
  refreshNonce?: number
  onOpenFile: (rel: string) => void
}) {
  const [rootEntries, setRootEntries] = createSignal<FsEntry[]>([])
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [selectedRel, setSelectedRel] = createSignal<string | null>(null)
  const [children, setChildren] = createSignal<Record<string, FsEntry[]>>({})
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  /** root 加载代际：重试/切目录时丢弃迟到结果。 */
  let loadToken = 0
  let lastRefreshNonce = props.refreshNonce ?? 0

  const persistScope = (update: (state: ContentScopeState) => ContentScopeState): void => {
    const key = props.scopeKey ?? null
    saveContentScopeState(key, update(contentScopeStateFor(key)))
  }

  const loadRoot = (expandedRels: readonly string[] = [...expanded()]) => {
    const root = props.contentRoot
    const token = ++loadToken
    setChildren({})
    setRootEntries([])
    setError(null)
    if (!root) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      try {
        const entries = await window.api.fs.listDir(root, "")
        if (token !== loadToken || root !== props.contentRoot) return
        setRootEntries(entries ?? [])
        for (const rel of expandedRels) {
          const childEntries = await window.api.fs.listDir(root, rel)
          if (token !== loadToken || root !== props.contentRoot) return
          if (childEntries) {
            setChildren(prev => ({ ...prev, [rel]: childEntries }))
          } else {
            setExpanded(prev => {
              if (!prev.has(rel)) return prev
              const next = new Set(prev)
              next.delete(rel)
              return next
            })
            persistScope((state) => setTreeExpanded(state, rel, false))
          }
        }
      } catch (e: any) {
        if (token === loadToken && root === props.contentRoot) {
          setError(`读取目录失败：${String(e?.message ?? e).slice(0, 60)}`)
        }
      } finally {
        if (token === loadToken) setLoading(false)
      }
    })()
  }

  // root/scope 变化（项目 ↔ Goal revision）→ 从 scope 状态恢复展开与选中。
  createEffect(() => {
    const scopeKey = props.scopeKey ?? null
    const saved = contentScopeStateFor(scopeKey)
    props.contentRoot
    releaseWatches()
    setExpanded(new Set(saved.treeExpanded))
    setSelectedRel(saved.treeSelected)
    loadRoot(saved.treeExpanded)
  })

  // ── 目录自动刷新（2026-10-31）：watch 根 + 当前展开目录 ─────────────
  // 折叠子树不显示，不监听；事件只重列受影响目录，不整树重置（防闪烁/丢展开态）。
  const watched = new Map<string, { root: string; release: () => void }>()

  function releaseWatches() {
    for (const [rel, entry] of [...watched]) {
      watched.delete(rel)
      entry.release()
    }
  }

  function syncWatches() {
    const root = props.contentRoot
    // 换 root 后旧 watch 一律退订（按注册时的 root，不按新 root）
    for (const [rel, entry] of [...watched]) {
      if (!root || entry.root !== root) {
        watched.delete(rel)
        entry.release()
      }
    }
    const wanted = new Set<string>()
    if (!root) return
    wanted.add("")
    for (const rel of expanded()) wanted.add(rel)
    const plan = planDirWatches(new Set(watched.keys()), wanted)
    for (const rel of plan.remove) {
      const entry = watched.get(rel)
      if (!entry) continue
      watched.delete(rel)
      entry.release()
    }
    for (const rel of plan.add) {
      watched.set(rel, { root, release: acquireDirWatch(root, rel) })
    }
  }

  createEffect(() => {
    props.contentRoot
    expanded()
    syncWatches()
  })

  // 左 dock 头部的手动刷新：保留展开态，只重列根与已展开目录。
  createEffect(() => {
    const nonce = props.refreshNonce ?? 0
    if (nonce === lastRefreshNonce) return
    lastRefreshNonce = nonce
    loadRoot()
  })

  async function refreshDir(rel: string) {
    const root = props.contentRoot
    if (!root) return
    const entries = await window.api.fs.listDir(root, rel)
    if (root !== props.contentRoot) return
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
      const watchedEntry = watched.get(rel)
      if (watchedEntry) {
        watched.delete(rel)
        watchedEntry.release()
      }
    }
  }

  onMount(() => {
    // 旧 preload（未重启 Electron）没有 onDirChanged：静默降级为手动刷新。
    const off = window.api.fs.onDirChanged?.(({ root, rel }) => {
      if (root !== props.contentRoot) return
      void refreshDir(rel)
    })
    // 返回/编辑器切 tab 会改写 scope 状态：同步选中行，不重载树。
    const offScope = onContentScopeStateChange((key, state) => {
      if (key !== (props.scopeKey ?? null)) return
      if (selectedRel() !== state.treeSelected) setSelectedRel(state.treeSelected)
    })
    onCleanup(() => {
      off?.()
      offScope()
      releaseWatches()
    })
  })

  const rows = () => visibleRows(rootEntries(), expanded(), children())

  const toggleDir = async (row: TreeRow) => {
    const root = props.contentRoot
    if (!root) return
    const exp = expanded()
    if (exp.has(row.rel)) {
      const next = new Set(exp)
      next.delete(row.rel)
      setExpanded(next)
      persistScope((state) => setTreeExpanded(state, row.rel, false))
      return
    }
    if (!children()[row.rel]) {
      try {
        const entries = await window.api.fs.listDir(root, row.rel)
        // root 已切换：丢弃迟到结果（终审 Important 2 同类）
        if (root !== props.contentRoot) return
        if (entries === null) {
          setError("无法读取该目录")
          return
        }
        setChildren(prev => ({ ...prev, [row.rel]: entries }))
      } catch (e: any) {
        if (root !== props.contentRoot) return
        setError(`读取目录失败：${String(e?.message ?? e).slice(0, 60)}`)
        return
      }
    }
    setExpanded(new Set([...expanded(), row.rel]))
    persistScope((state) => setTreeExpanded(state, row.rel, true))
  }

  const activate = (row: TreeRow) => {
    if (row.kind === "dir") {
      void toggleDir(row)
      return
    }
    setSelectedRel(row.rel)
    persistScope((state) => selectTreeFile(state, row.rel))
    props.onOpenFile(row.rel)
  }

  const absPath = (rel: string) => {
    const root = (props.contentRoot ?? "").replace(/[\\/]+$/, "")
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
      <Show when={props.showHeader !== false}>
        <DockPanelHeader title={props.title ?? "文件"}>
          {props.headerAction}
          <TooltipV2 value="刷新" openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              aria-label="刷新文件树"
              disabled={!props.contentRoot || loading()}
              onClick={() => loadRoot()}
            >
              <Icon name="refresh" size="small" />
            </ButtonV2>
          </TooltipV2>
        </DockPanelHeader>
      </Show>
      <Show when={error()}>
        <DockBanner kind="error" text={error()!} action={{ label: "重试", onClick: () => loadRoot() }} />
      </Show>
      <div class="mafw-file-tree">
        <Show
          when={props.contentRoot}
          fallback={<DockEmpty icon="file-tree" text="未选择项目" hint="打开项目后此处显示项目文件" />}
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
                classList={{
                  "mafw-file-tree-row-dir": row.kind === "dir",
                  "is-selected": row.kind === "file" && selectedRel() === row.rel,
                }}
                aria-current={row.kind === "file" && selectedRel() === row.rel ? "true" : undefined}
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
