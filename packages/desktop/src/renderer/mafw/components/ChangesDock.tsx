// ChangesDock（dock changes tab）：当前会话改动文件的常驻入口。
// B2：平铺列表 → 可折叠目录树；树/统计来自 aggregateSessionDiffs（per-turn 汇总），
// 实时脉冲来自 store.session_diff（SSE session.diff）；每会话第一份 live 快照只建基线。
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { DiffReviewPanel, type FileDiffEntry } from "./DiffReviewPanel"
import { buildChangeTree, changedDiffPaths, changeStatusLetter, type ChangeTreeNode } from "./change-tree"

function ChangeNode(props: {
  node: ChangeTreeNode
  depth: number
  collapsed: Set<string>
  pulse: Set<string>
  onToggle: (path: string) => void
  onOpen: (entry: FileDiffEntry) => void
}) {
  const isDir = () => props.node.kind === "dir"
  const open = () => !props.collapsed.has(props.node.path)
  const indent = () => ({ "padding-left": `${8 + props.depth * 12}px` })
  const statusLetter = () => changeStatusLetter(props.node.status)

  return (
    <Show
      when={isDir()}
      fallback={
        <div
          class="mafw-changes-row mafw-change-file"
          classList={{ "mafw-change-pulse": props.pulse.has(props.node.path) }}
          style={indent()}
          role="button"
          tabIndex={0}
          aria-label={props.node.path}
          onClick={() => { if (props.node.file) props.onOpen(props.node.file) }}
          onKeyDown={(e: KeyboardEvent) => {
            if ((e.key === "Enter" || e.key === " ") && props.node.file) {
              e.preventDefault()
              props.onOpen(props.node.file)
            }
          }}
        >
          <span class="mafw-change-name">{props.node.name}</span>
          <Show when={statusLetter()}>
            <span class="mafw-change-status" data-status={props.node.status}>{statusLetter()}</span>
          </Show>
          <span class="mafw-diff-stat add">+{props.node.additions}</span>
          <span class="mafw-diff-stat del">-{props.node.deletions}</span>
        </div>
      }
    >
      <div
        class="mafw-change-dir"
        style={indent()}
        role="button"
        tabIndex={0}
        aria-expanded={open()}
        aria-label={props.node.path}
        onClick={() => props.onToggle(props.node.path)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            props.onToggle(props.node.path)
          }
        }}
      >
        <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
        <Icon name="folder" size="small" />
        <span class="mafw-change-name">{props.node.name}</span>
        <span class="mafw-diff-stat add">+{props.node.additions}</span>
        <span class="mafw-diff-stat del">-{props.node.deletions}</span>
      </div>
      <Show when={open()}>
        <For each={props.node.children}>
          {(child) => (
            <ChangeNode
              node={child}
              depth={props.depth + 1}
              collapsed={props.collapsed}
              pulse={props.pulse}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
            />
          )}
        </For>
      </Show>
    </Show>
  )
}

export function ChangesDock(props: {
  sessionID: string | null
  diffs: FileDiffEntry[] | undefined
  /** SSE session.diff 实时快照（未收到首帧前为 undefined；不要默认 []） */
  liveDiffs?: FileDiffEntry[]
  onSendComment?: (sessionID: string, text: string) => void
  /** 加入批注草稿（同一批注池） */
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
}) {
  const [openFile, setOpenFile] = createSignal<string | null>(null)
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set<string>())
  const [pulse, setPulse] = createSignal<Set<string>>(new Set<string>())
  const files = () => props.diffs ?? []
  const tree = createMemo(() => buildChangeTree(files()))
  const totalAdd = () => files().reduce((n, f) => n + (f.additions ?? 0), 0)
  const totalDel = () => files().reduce((n, f) => n + (f.deletions ?? 0), 0)

  let pulseTimer: ReturnType<typeof setTimeout> | null = null
  let lastSid: string | null = null
  let seen = false
  let prevLive: FileDiffEntry[] | null = null

  createEffect(() => {
    const sid = props.sessionID
    const live = props.liveDiffs
    if (sid !== lastSid) {
      lastSid = sid
      seen = false
      prevLive = null
      setCollapsed(new Set<string>())
      setPulse(new Set<string>())
      setOpenFile(null)
    }
    if (!Array.isArray(live)) return
    if (!seen) {
      seen = true
      prevLive = live
      return
    }
    const changed = changedDiffPaths(prevLive, live)
    prevLive = live
    if (changed.size === 0) return
    setPulse(changed)
    if (pulseTimer) clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => setPulse(new Set<string>()), 1200)
  })

  onCleanup(() => { if (pulseTimer) clearTimeout(pulseTimer) })

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const openEntry = (entry: FileDiffEntry) => {
    if (props.sessionID) setOpenFile(entry.file ?? "(unknown)")
  }

  return (
    <div class="mafw-changes-dock">
      <Show when={openFile() && props.sessionID}>
        <DiffReviewPanel
          embedded
          sessionID={props.sessionID!}
          diffs={props.diffs}
          initialFile={openFile()}
          onBack={() => setOpenFile(null)}
          onSendComment={props.onSendComment}
          onAddAnnotation={props.onAddAnnotation}
        />
      </Show>
      <Show when={!openFile()}>
        <div class="mafw-changes-dock-head">
          <span class="mafw-changes-dock-title">改动</span>
          <Show when={files().length > 0}>
            <span class="mafw-changes-dock-stats">
              {files().length} 个文件 <span class="mafw-diff-stat add">+{totalAdd()}</span>{" "}
              <span class="mafw-diff-stat del">-{totalDel()}</span>
            </span>
          </Show>
        </div>
        <Show when={props.sessionID} fallback={<p class="mafw-changes-dock-empty">没有打开的会话。</p>}>
          <Show
            when={files().length > 0}
            fallback={<p class="mafw-changes-dock-empty">当前会话没有待审的文件改动。</p>}
          >
            <div class="mafw-changes-dock-list">
              <For each={tree()}>
                {(node) => (
                  <ChangeNode
                    node={node}
                    depth={0}
                    collapsed={collapsed()}
                    pulse={pulse()}
                    onToggle={toggleDir}
                    onOpen={openEntry}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
