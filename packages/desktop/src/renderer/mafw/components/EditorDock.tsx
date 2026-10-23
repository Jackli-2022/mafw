// EditorDock：RightDock「编辑器」tab —— 人机协同编辑器（spec §5.2）。
// - 打开文件（来自「文件」tab 的 editor-open 请求）→ CodeMirror 6；
// - VSCode 式保存（Ctrl+S / 保存按钮，显式写盘；dirty 缓冲不自动落盘）；
// - 外部改动（agent 改了同一文件）：干净 → 静默刷新；dirty → 冲突横幅（绝不静默覆盖）；
// - 保存时 mtime 版本校验（调研 §3 防线②）：磁盘已变 → 冲突，覆盖需显式选择；
// - 草稿/基准存 editor-drafts（root-scoped 模块单例）：卸载（关 dock/connDown）不丢。
import { createSignal, createEffect, onCleanup, onMount, untrack, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import {
  createEditorModel, onRootChange, openFile, closeFile, setActive,
  markDirty, markSaved, onExternalChange, resolveConflict, applyCleanReload, canApplyCleanReload,
  type EditorModel, type OpenFile,
} from "../editor-state"
import {
  clearDraft, getDraft, getEol, getMtime, setDraft, setEol, setMtime,
} from "../editor-drafts"
import { consumeEditorOpen, pendingEditorOpen } from "../editor-open"
import { langForFile } from "../editor/cm-lang"
import { mountEditor, type MountedEditor } from "../editor/cm-setup"
import { annotationApplies, buildAnnotationPrompt, lineRangeOf } from "../editor-annotation"
import { diffEntryFor } from "../editor-diff"
import { LineCommentEditorV2 } from "@mafw/ui/v2/line-comment-v2"
import { DiffReviewPanel, type FileDiffEntry } from "./DiffReviewPanel"

interface SelectionState {
  rel: string
  from: number
  to: number
  text: string
  left: number
  top: number
}

export function EditorDock(props: {
  sessionID: string | null
  sessionDirectory: string | null
  diffs?: FileDiffEntry[]
  onSendAnnotation?: (text: string) => void
  /** 加入批注草稿（v2：草稿优先，发送时随消息打包） */
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
  onSendComment?: (sid: string, text: string) => void
}) {
  const [model, setModel] = createSignal<EditorModel>(createEditorModel())
  const [readNotes, setReadNotes] = createSignal<Record<string, string>>({})
  const [saving, setSaving] = createSignal(false)
  const [sel, setSel] = createSignal<SelectionState | null>(null)
  const [annotOpen, setAnnotOpen] = createSignal(false)
  const [annotDraft, setAnnotDraft] = createSignal("")
  const [mode, setMode] = createSignal<"edit" | "diff">("edit")

  let host: HTMLDivElement | undefined
  let editor: MountedEditor | null = null
  let mountToken = 0
  /** setDoc 程序化写入期间抑制 markDirty。 */
  let applyingExternal = false
  /** 已 watch 的 (root, rel)；root 变化时用旧 root 退订。 */
  const watched = new Set<string>() // `${root}\u0000${rel}`

  const activeFile = (): OpenFile | null =>
    model().files.find(f => f.rel === model().active) ?? null

  const noteFor = (rel: string) => readNotes()[rel]

  function clearSelection() {
    setSel(null)
    setAnnotOpen(false)
    setAnnotDraft("")
  }

  async function unwatchAll() {
    for (const entry of watched) {
      const i = entry.indexOf("\u0000")
      const root = entry.slice(0, i)
      const rel = entry.slice(i + 1)
      void window.api.fs.unwatch(root, rel)
    }
    watched.clear()
  }

  // ── root 跟随（切会话/worktree）：模型清空、退订旧 watch、清选区 ─────
  createEffect(() => {
    const root = props.sessionDirectory
    if (root === model().root) return
    setModel(m => onRootChange(m, root))
    setReadNotes({})
    clearSelection()
    setMode("edit")
    void unwatchAll()
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
      setMode("edit")
      clearSelection()
      void mountActive()
      return
    }
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (root !== props.sessionDirectory) return // root 已切换：丢弃迟到的结果（Important 2）
      if (res.ok) {
        setMtime(root, rel, res.mtimeMs)
        setEol(root, rel, res.eol)
        setModel(m => openFile(m, rel, res.content))
      } else if (res.reason === "too-large" || res.reason === "binary" || res.reason === "encoding") {
        const note = res.reason === "binary" ? "二进制文件（只读）"
          : res.reason === "too-large" ? "文件超过 1MB（只读）"
            : "非 UTF-8 编码（只读，防保存损坏）"
        setReadNotes(prev => ({ ...prev, [rel]: note }))
        setModel(m => openFile(m, rel, "", true))
      } else {
        showToastV2({
          description: res.reason === "not-found" ? "文件不存在（可能已被移动/删除）" : "读取文件失败",
          variant: "error",
          duration: 3000,
        } as any)
        return
      }
      setMode("edit")
      clearSelection()
      void mountActive()
    } catch (e: any) {
      showToastV2({ description: `读取文件失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  // ── 挂载编排（事件驱动；不用 effect：避免 markDirty 每个键重挂载）────
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
    await unwatchAll() // 先退订（含 f=null 的情形，防旧 watch 泄漏）
    if (!f) return
    const root = props.sessionDirectory
    if (!root) return
    try {
      const h = await mountEditor(el, {
        doc: getDraft(root, f.rel) ?? f.savedContent,
        readOnly: f.readOnly,
        lang: langForFile(f.rel),
        onDocChanged: () => {
          if (applyingExternal) return // 程序化 setDoc 不算用户编辑（Critical 1）
          setDraft(root, f.rel, h.getDoc())
          setModel(m => markDirty(m, f.rel))
        },
        onSave: () => void saveActive(),
        onSelectionChange: (s) => {
          if (!s) { clearSelection(); return }
          setSel({ rel: f.rel, ...s })
        },
      })
      if (token !== mountToken) { h.destroy(); return }
      editor = h
      if (!f.readOnly) {
        const key = `${root}\u0000${f.rel}`
        watched.add(key)
        void window.api.fs.watch(root, f.rel)
      }
    } catch (e: any) {
      console.warn("[editor] mount failed", e)
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
      void unwatchAll()
      editor?.destroy()
      editor = null
    })
  })

  async function reloadClean(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (root !== props.sessionDirectory || !res.ok) return
      // await 期间用户可能开始输入 → 禁止静默覆盖（Critical 1）
      if (!canApplyCleanReload(model(), rel)) return
      setMtime(root, rel, res.mtimeMs)
      setEol(root, rel, res.eol)
      clearDraft(root, rel)
      setModel(m => applyCleanReload(m, rel, res.content))
      if (model().active === rel && editor) {
        applyingExternal = true
        editor.setDoc(res.content)
        applyingExternal = false
      }
    } catch { /* 重读失败：保留 staleClean，等下次事件 */ }
  }

  function setDocs(content: string) {
    applyingExternal = true
    editor?.setDoc(content)
    applyingExternal = false
  }

  // ── 保存（显式 + mtime 版本校验 + EOL 保真）─────────────────────────
  async function saveActive(force = false) {
    const f = activeFile()
    const root = props.sessionDirectory
    if (!f || !root || f.readOnly || saving()) return
    const content = getDraft(root, f.rel) ?? editor?.getDoc() ?? f.savedContent
    setSaving(true)
    try {
      const res = await window.api.fs.writeFile(root, f.rel, content, {
        ...(force ? {} : { ifMtimeMs: getMtime(root, f.rel) }),
        eol: getEol(root, f.rel) ?? "\n",
      })
      if (root !== props.sessionDirectory) return
      if (res.ok) {
        clearDraft(root, f.rel)
        setModel(m => markSaved(m, f.rel, content))
        const after = await window.api.fs.readFile(root, f.rel)
        if (after.ok) {
          setMtime(root, f.rel, after.mtimeMs)
          setEol(root, f.rel, after.eol)
          // 写后读：若内容已变（agent 紧随其后写入），不把我们的 mtime 当基准
          if (after.content !== content) setModel(m => onExternalChange(m, f.rel))
        }
        showToastV2({ description: "已保存", duration: 1200 } as any)
      } else if (res.reason === "conflict") {
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
    if (root !== props.sessionDirectory) return
    if (!res.ok) {
      showToastV2({ description: res.reason === "not-found" ? "文件已被删除" : "读取失败", variant: "error", duration: 3000 } as any)
      return
    }
    setMtime(root, rel, res.mtimeMs)
    setEol(root, rel, res.eol)
    clearDraft(root, rel)
    setModel(m => resolveConflict(m, rel, "reload", res.content))
    if (model().active === rel) setDocs(res.content)
  }

  function keepMine(rel: string) {
    setModel(m => resolveConflict(m, rel, "keep-mine"))
  }

  function closeRel(rel: string) {
    const root = props.sessionDirectory
    if (root) clearDraft(root, rel)
    setModel(m => closeFile(m, rel))
    setMode("edit")
    clearSelection()
    void mountActive()
  }

  async function openExternal(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    const res = await window.api.fs.openExternal(root, rel)
    if (!res.ok) showToastV2({ description: "无法在外部编辑器打开", variant: "error", duration: 3000 } as any)
  }

  const selRange = () => {
    const s = sel()
    if (!s) return null
    return lineRangeOf(editor?.getDoc() ?? "", s.from, s.to)
  }

  function submitAnnotation(comment: string, action: "draft" | "send" = "draft") {
    const s = sel()
    const f = activeFile()
    const range = selRange()
    if (!s || !f || !range || !comment.trim()) return
    if (!annotationApplies(f.rel, s.rel)) { clearSelection(); return }
    if (action === "send") {
      if (!props.onSendAnnotation) return
      props.onSendAnnotation(buildAnnotationPrompt(f.rel, range.startLine, range.endLine, s.text, comment.trim()))
    } else {
      if (!props.onAddAnnotation) return
      props.onAddAnnotation({
        rel: f.rel,
        startLine: range.startLine,
        endLine: range.endLine,
        code: s.text,
        comment: comment.trim(),
      })
    }
    clearSelection()
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
                onClick={() => { setModel(m => setActive(m, f.rel)); setMode("edit"); clearSelection(); void mountActive() }}
                onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { setModel(m => setActive(m, f.rel)); setMode("edit"); clearSelection(); void mountActive() } }}
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
            <Show when={activeFile() && diffEntryFor(props.diffs, activeFile()!.rel)}>
              <ButtonV2
                variant={mode() === "diff" ? "contrast" : "ghost"}
                size="small"
                onClick={() => { setMode(mode() === "diff" ? "edit" : "diff"); clearSelection() }}
              >改动</ButtonV2>
            </Show>
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

        {/* 只读原因（binary/超大/非 UTF-8） */}
        <Show when={activeFile() && noteFor(activeFile()!.rel)}>
          <div class="mafw-editor-note">{noteFor(activeFile()!.rel)}</div>
        </Show>

        <div class="mafw-editor-body">
          <div class="mafw-editor-host" ref={(el) => { host = el }} style={{ display: mode() === "diff" ? "none" : "block" }} />

          {/* 选区批注入口（人标出 → agent 改）：浮钮 → 浮层（仅编辑模式） */}
          <Show when={mode() === "edit" && sel() && !annotOpen() && props.onSendAnnotation}>
            <div class="mafw-editor-annot-anchor" style={{ left: `${Math.max(8, sel()!.left)}px`, top: `${sel()!.top + 4}px` }}>
              <ButtonV2 variant="outline" size="small" onClick={() => { setAnnotDraft(""); setAnnotOpen(true) }}>批注</ButtonV2>
            </div>
          </Show>
          <Show when={mode() === "edit" && annotOpen() && sel()}>
            <div class="mafw-editor-annot-pop" style={{ left: `${Math.max(8, Math.min(sel()!.left, 420))}px`, top: `${sel()!.top + 4}px` }}>
              <LineCommentEditorV2
                value={annotDraft()}
                onInput={setAnnotDraft}
                onCancel={() => setAnnotOpen(false)}
                onSubmit={(value: string) => submitAnnotation(value, "draft")}
                selection={<span>{sel()!.rel}:L{selRange()?.startLine}-{selRange()?.endLine}</span>}
                placeholder="对这一段的批注…"
                submitLabel="加入批注"
                secondaryLabel={props.onSendAnnotation ? "立即发送" : undefined}
                onSecondary={props.onSendAnnotation ? (value: string) => submitAnnotation(value, "send") : undefined}
                cancelLabel="取消"
              />
            </div>
          </Show>

          <Show when={mode() === "diff" && activeFile() && props.sessionID}>
            <div class="mafw-editor-diff">
              <DiffReviewPanel
                embedded
                sessionID={props.sessionID!}
                diffs={props.diffs}
                initialFile={activeFile()!.rel}
                onBack={() => { setMode("edit"); clearSelection() }}
                onSendComment={props.onSendComment}
                onAddAnnotation={props.onAddAnnotation}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
