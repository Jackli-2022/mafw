// EditorDock：RightDock「编辑器」tab —— 人机协同编辑器（spec §5.2）。
// - 打开文件（来自「文件」tab 的 editor-open 请求）→ CodeMirror 6；
// - VSCode 式保存（Ctrl+S / 保存按钮，显式写盘；dirty 缓冲不自动落盘）；
// - 外部改动（agent 改了同一文件）：干净 → 静默刷新；dirty → 冲突横幅（绝不静默覆盖）；
// - 保存时 mtime 版本校验（调研 §3 防线②）：磁盘已变 → 冲突，覆盖需显式选择。
import { createSignal, createEffect, onCleanup, onMount, untrack, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import {
  createEditorModel, onRootChange, openFile, closeFile, setActive,
  markDirty, markSaved, onExternalChange, resolveConflict, applyCleanReload,
  type EditorModel, type OpenFile,
} from "../editor-state"
import { consumeEditorOpen, pendingEditorOpen } from "../editor-open"
import { langForFile } from "../editor/cm-lang"
import { mountEditor, type MountedEditor } from "../editor/cm-setup"
import type { FileDiffEntry } from "./DiffReviewPanel"

export function EditorDock(props: {
  sessionID: string | null
  sessionDirectory: string | null
  diffs?: FileDiffEntry[]
  onSendAnnotation?: (text: string) => void
  onSendComment?: (sid: string, text: string) => void
}) {
  const [model, setModel] = createSignal<EditorModel>(createEditorModel())
  const [readNotes, setReadNotes] = createSignal<Record<string, string>>({})
  const [saving, setSaving] = createSignal(false)

  let host: HTMLDivElement | undefined
  let editor: MountedEditor | null = null
  let mountToken = 0
  /** 未保存草稿（切 tab 不丢）；保存/重载后清。 */
  const drafts = new Map<string, string>()
  /** 打开/保存时的磁盘 mtime（保存版本校验基准）。 */
  const mtimes = new Map<string, number>()
  /** 已 watch 的文件（root 变化/切换时统一退订）。 */
  const watchedRels = new Set<string>()
  /** setDoc 程序化写入期间抑制 markDirty。 */
  let applyingExternal = false

  const activeFile = (): OpenFile | null =>
    model().files.find(f => f.rel === model().active) ?? null

  const noteFor = (rel: string) => readNotes()[rel]

  // ── root 跟随（切会话/worktree → 清空打开文件并卸载编辑器）──────────
  createEffect(() => {
    const root = props.sessionDirectory
    setModel(m => onRootChange(m, root))
    setReadNotes({})
    untrack(() => { void mountActive() })
  })

  // ── 打开请求（FilesDock → editor-open）───────────────────────────────
  createEffect(() => {
    const req = pendingEditorOpen()
    if (!req) return
    consumeEditorOpen()
    if (req.root !== props.sessionDirectory) return
    void openRel(req.rel)
  })

  async function openRel(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    if (model().files.some(f => f.rel === rel)) {
      setModel(m => setActive(m, rel))
      void mountActive()
      return
    }
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (res.ok) {
        mtimes.set(rel, res.mtimeMs)
        setModel(m => openFile(m, rel, res.content))
        void mountActive()
      } else if (res.reason === "too-large" || res.reason === "binary") {
        setReadNotes(prev => ({ ...prev, [rel]: res.reason === "binary" ? "二进制文件（只读）" : "文件超过 1MB（只读）" }))
        setModel(m => openFile(m, rel, "", true))
        void mountActive()
      } else {
        showToastV2({
          description: res.reason === "not-found" ? "文件不存在（可能已被移动/删除）" : "读取文件失败",
          variant: "error",
          duration: 3000,
        } as any)
      }
    } catch (e: any) {
      showToastV2({ description: `读取文件失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  // ── 挂载编排（事件驱动，不用 effect：避免 markDirty 每个键重挂载）────
  async function mountActive() {
    const f = activeFile()
    const el = host
    if (!el) return
    await mountFor(f, el)
  }

  async function mountFor(f: OpenFile | null, el: HTMLElement) {
    const token = ++mountToken
    editor?.destroy()
    editor = null
    if (!f) return
    const root = props.sessionDirectory
    try {
      const h = await mountEditor(el, {
        doc: drafts.get(f.rel) ?? f.savedContent,
        readOnly: f.readOnly,
        lang: langForFile(f.rel),
        onDocChanged: () => {
          if (!applyingExternal) drafts.set(f.rel, h.getDoc())
          setModel(m => markDirty(m, f.rel))
        },
        onSave: () => void saveActive(),
      })
      if (token !== mountToken) { h.destroy(); return }
      editor = h
      if (root) {
        for (const old of watchedRels) void window.api.fs.unwatch(root, old)
        watchedRels.clear()
        if (!f.readOnly) {
          watchedRels.add(f.rel)
          void window.api.fs.watch(root, f.rel)
        }
      }
    } catch (e: any) {
      showToastV2({ description: `编辑器加载失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  onMount(() => {
    const off = window.api.fs.onChanged(({ root, rel }) => {
      if (root !== props.sessionDirectory) return
      const f = model().files.find(x => x.rel === rel)
      if (!f || f.readOnly) return
      setModel(m => onExternalChange(m, rel))
      if (!f.dirty) void reloadClean(rel)
    })
    onCleanup(() => {
      off()
      const root = props.sessionDirectory
      if (root) for (const rel of watchedRels) void window.api.fs.unwatch(root, rel)
      watchedRels.clear()
      editor?.destroy()
      editor = null
    })
  })

  async function reloadClean(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (!res.ok) return
      mtimes.set(rel, res.mtimeMs)
      drafts.delete(rel)
      setModel(m => applyCleanReload(m, rel, res.content))
      if (model().active === rel && editor) {
        applyingExternal = true
        editor.setDoc(res.content)
        applyingExternal = false
      }
    } catch { /* watch 触发的重读失败：保留 staleClean，等下次事件 */ }
  }

  function setDocs(content: string) {
    applyingExternal = true
    editor?.setDoc(content)
    applyingExternal = false
  }

  // ── 保存（显式 + mtime 版本校验）─────────────────────────────────────
  async function saveActive(force = false) {
    const f = activeFile()
    const root = props.sessionDirectory
    if (!f || !root || f.readOnly || saving()) return
    const content = drafts.get(f.rel) ?? editor?.getDoc() ?? f.savedContent
    setSaving(true)
    try {
      const res = await window.api.fs.writeFile(root, f.rel, content, force ? undefined : { ifMtimeMs: mtimes.get(f.rel) })
      if (res.ok) {
        drafts.delete(f.rel)
        setModel(m => markSaved(m, f.rel, content))
        const after = await window.api.fs.readFile(root, f.rel)
        if (after.ok) mtimes.set(f.rel, after.mtimeMs)
        showToastV2({ description: "已保存", duration: 1200 } as any)
      } else if (res.reason === "conflict") {
        // 保存时磁盘已变（watch 防抖窗口外，典型是 agent 刚写了同一文件）
        setModel(m => onExternalChange(m, f.rel))
      } else if (res.reason === "not-found") {
        showToastV2({ description: "文件已被删除，无法保存", variant: "error", duration: 3000 } as any)
      } else {
        showToastV2({ description: "保存失败", variant: "error", duration: 3000 } as any)
      }
    } finally {
      setSaving(false)
    }
  }

  async function reloadFromDisk(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    const res = await window.api.fs.readFile(root, rel)
    if (!res.ok) {
      showToastV2({ description: res.reason === "not-found" ? "文件已被删除" : "读取失败", variant: "error", duration: 3000 } as any)
      return
    }
    mtimes.set(rel, res.mtimeMs)
    drafts.delete(rel)
    setModel(m => resolveConflict(m, rel, "reload", res.content))
    if (model().active === rel) setDocs(res.content)
  }

  function keepMine(rel: string) {
    setModel(m => resolveConflict(m, rel, "keep-mine"))
  }

  function closeRel(rel: string) {
    drafts.delete(rel)
    setModel(m => closeFile(m, rel))
    void mountActive()
  }

  async function openExternal(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    const res = await window.api.fs.openExternal(root, rel)
    if (!res.ok) showToastV2({ description: "无法在外部编辑器打开", variant: "error", duration: 3000 } as any)
  }

  return (
    <div class="mafw-editor-dock">
      <Show
        when={model().files.length > 0}
        fallback={<div class="mafw-file-tree-empty">从「文件」tab 选择文件打开</div>}
      >
        <div class="mafw-editor-tabs">
          <For each={model().files}>
            {(f) => (
              <div
                class="mafw-editor-tab"
                classList={{ "mafw-editor-tab-active": model().active === f.rel }}
                role="button"
                tabIndex={0}
                title={f.rel}
                onClick={() => { setModel(m => setActive(m, f.rel)); void mountActive() }}
                onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { setModel(m => setActive(m, f.rel)); void mountActive() } }}
              >
                <span class="mafw-editor-tab-name">{f.rel.split("/").pop()}</span>
                <Show when={f.dirty}><span class="mafw-editor-tab-dot" title="未保存">●</span></Show>
                <Show when={f.readOnly}><span class="mafw-editor-tab-ro">只读</span></Show>
                <span
                  class="mafw-editor-tab-close"
                  role="button"
                  tabIndex={0}
                  title="关闭"
                  onClick={(e) => { e.stopPropagation(); closeRel(f.rel) }}
                  onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { e.stopPropagation(); closeRel(f.rel) } }}
                >×</span>
              </div>
            )}
          </For>
          <div class="mafw-editor-tab-actions">
            <ButtonV2
              variant="ghost"
              size="small"
              disabled={!activeFile() || !!activeFile()?.readOnly || saving()}
              onClick={() => void saveActive()}
            >保存</ButtonV2>
            <ButtonV2
              variant="ghost"
              size="small"
              disabled={!activeFile()}
              onClick={() => { const f = activeFile(); if (f) void openExternal(f.rel) }}
            >外部编辑器</ButtonV2>
          </div>
        </div>

        {/* 冲突横幅：dirty + 磁盘已变（watch 或保存校验）→ 绝不静默覆盖 */}
        <Show when={activeFile()?.conflict}>
          <div class="mafw-editor-conflict">
            <span class="mafw-editor-conflict-text">磁盘已被改动（可能被 agent 修改）</span>
            <div class="mafw-editor-conflict-actions">
              <ButtonV2 variant="outline" size="small" onClick={() => { const f = activeFile(); if (f) void saveActive(true) }}>覆盖保存</ButtonV2>
              <ButtonV2 variant="ghost" size="small" onClick={() => { const f = activeFile(); if (f) keepMine(f.rel) }}>保留我的修改</ButtonV2>
              <ButtonV2 variant="ghost" size="small" onClick={() => { const f = activeFile(); if (f) void reloadFromDisk(f.rel) }}>重新加载</ButtonV2>
            </div>
          </div>
        </Show>

        {/* 只读原因（binary/超大） */}
        <Show when={activeFile() && noteFor(activeFile()!.rel)}>
          <div class="mafw-editor-note">{noteFor(activeFile()!.rel)}</div>
        </Show>

        <div class="mafw-editor-host" ref={(el) => { host = el }} />
      </Show>
    </div>
  )
}
