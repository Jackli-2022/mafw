// EditorDock：RightDock「编辑器」tab —— 人机协同编辑器（spec §5.2）。
// - 打开文件（来自「文件」tab 的 editor-open 请求）→ CodeMirror 6；
// - VSCode 式保存（Ctrl+S / 保存按钮，显式写盘；dirty 缓冲不自动落盘）；
// - 外部改动（agent 改了同一文件）：干净 → 静默刷新；dirty → 冲突横幅（绝不静默覆盖）；
// - 保存时 mtime 版本校验（调研 §3 防线②）：磁盘已变 → 冲突，覆盖需显式选择；
// - 草稿/基准存 editor-drafts（root-scoped 模块单例）：卸载（关 dock/connDown）不丢。
import { createSignal, createEffect, createMemo, onCleanup, onMount, untrack, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { Icon } from "@mafw/ui/icon"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"
import {
  createEditorModel, onRootChange, openFile, closeFile, setActive,
  markDirty, markSaved, onExternalChange, resolveConflict, applyCleanReload, canApplyCleanReload,
  isReadOnlyPreview,
  type EditorModel, type OpenFile,
} from "../editor-state"
import {
  clearDraft, getDraft, getEol, getMtime, setDraft, setEol, setMtime,
} from "../editor-drafts"
import { consumeEditorOpen, pendingEditorOpen } from "../editor-open"
import { fileKindFor } from "../file-kind"
import { fileProtocol } from "../file-protocol-client"
import { parseCsv } from "../csv-parse"
import { Markdown } from "@mafw/session-ui/markdown"
import { JsonPreview } from "./JsonPreview"
import { OfficePreview } from "./OfficePreview"
import { langForFile } from "../editor/cm-lang"
import { mountEditor, type MountedEditor } from "../editor/cm-setup"
import { annotationApplies, buildAnnotationPrompt, buildAnnotationPromptAnchored, lineRangeOf } from "../editor-annotation"
import { diffEntryFor } from "../editor-diff"
import { AnnotationPopover } from "./AnnotationPopover"
import { buildQuoteAnchor } from "../quote-anchor"
import { describeAnchor, jsonPathOf, a1Ref } from "../annotation-anchor"
import { dragRectPx, cropImageDataUrl, type Rect01 } from "../region-capture"
import { addMark, marksFor } from "../annotation-marks"
import type { AnnotationAnchor } from "../../../shared/annotation-types"
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
  onSendAnnotation?: (text: string, opts?: { imageDataUrl?: string }) => void
  /** 加入批注草稿（v2：草稿优先，发送时随消息打包） */
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string; anchor?: AnnotationAnchor; imageDataUrl?: string }) => void
  onSendComment?: (sid: string, text: string) => void
  /** 批注标记点击 → 切到审阅面（回路闭合）。 */
  onOpenReview?: () => void
}) {
  const [model, setModel] = createSignal<EditorModel>(createEditorModel())
  const [readNotes, setReadNotes] = createSignal<Record<string, string>>({})
  const [saving, setSaving] = createSignal(false)
  const [sel, setSel] = createSignal<SelectionState | null>(null)
  const [annotOpen, setAnnotOpen] = createSignal(false)
  /** 预览划选批注（md/docx）：锚点 + 浮层坐标（相对 editor-body）。 */
  const [quoteSel, setQuoteSel] = createSignal<{ anchor: AnnotationAnchor; left: number; top: number } | null>(null)
  const [quoteOpen, setQuoteOpen] = createSignal(false)
  /** 预览锚点批注（json 节点 / 表格单元格 / 图片区域 / pptx 图钉）：标记即输入。 */
  const [anchorSel, setAnchorSel] = createSignal<{ anchor: AnnotationAnchor; left: number; top: number; imageDataUrl?: string } | null>(null)
  const [anchorOpen, setAnchorOpen] = createSignal(false)
  /** 图片拖框（region 批注）：px 坐标 + 图片盒尺寸。 */
  const [drag, setDrag] = createSignal<{ x0: number; y0: number; x1: number; y1: number; w: number; h: number } | null>(null)
  let dragStart: { x: number; y: number } | null = null
  let bodyEl: HTMLDivElement | undefined
  const [mode, setMode] = createSignal<"edit" | "diff">("edit")
  /** 常驻 IO 错误（读/存/外部打开失败）——统一 DockBanner，不再只用 toast。 */
  const [ioError, setIoError] = createSignal<string | null>(null)
  /** mafw-file:// 版本（mtime / 变更时刻）——图片与 SVG 预览的缓存破坏参数。 */
  const [fileVersion, setFileVersion] = createSignal<Record<string, number>>({})
  /** 图片/SVG 预览元数据（natural 尺寸 + 文件大小）。 */
  const [imageMeta, setImageMeta] = createSignal<Record<string, { w: number; h: number; size?: number }>>({})
  /** 源码/预览切换（svg、csv/tsv 共用）：缺省 = 预览态；显式 true = 源码态。
   *  2026-10-27：打开即看（用户裁决 + VS Code/JetBrains 主流），源码是一键动作。 */
  const [sourceMode, setSourceMode] = createSignal<Record<string, boolean>>({})

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

  /** mafw-file:// URL（带版本号破缓存）；token 未就绪 → 空串（<img> 不渲染）。 */
  const previewUrl = (rel: string): string => {
    const root = props.sessionDirectory
    return (root && fileProtocol.urlFor(root, rel, fileVersion()[rel])) ?? ""
  }

  /** 预览态：图片恒预览；svg / csv-tsv / markdown / json 默认预览（仅显式源码态例外）。diff 模式不预览。 */
  const showsPreview = (f: OpenFile): boolean => {
    if (f.kind === "svg" || f.kind === "table" || f.kind === "markdown" || f.kind === "json") return sourceMode()[f.rel] !== true
    return false
  }
  const previewing = (): boolean => {
    const f = activeFile()
    if (!f || mode() !== "edit") return false
    if (isReadOnlyPreview(f.kind)) return true
    return showsPreview(f)
  }

  /** tab 头切换按钮文案：预览中 → 「源码」；源码态 → 「表格」（csv/tsv）/「树」（json）/「预览」（svg/markdown）。 */
  const previewToggleLabel = (): string => {
    const f = activeFile()
    if (!f) return "预览"
    if (previewing()) return "源码"
    if (f.kind === "table") return "表格"
    if (f.kind === "json") return "树"
    return "预览"
  }

  const togglePreview = () => {
    const f = activeFile()
    if (!f || (f.kind !== "svg" && f.kind !== "table" && f.kind !== "markdown" && f.kind !== "json")) return
    setSourceMode(prev => ({ ...prev, [f.rel]: prev[f.rel] !== true }))
    clearSelection()
    // 预览期间 CodeMirror 宿主 display:none；切回源码后强制重测（防 0 尺寸视图）。
    queueMicrotask(() => {
      if (!previewing()) editor?.measure()
    })
  }

  const recordImageDims = (rel: string, img: HTMLImageElement) => {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return
    setImageMeta(prev => ({ ...prev, [rel]: { ...prev[rel], w, h } }))
  }

  const previewMeta = (f: OpenFile): string => {
    const meta = imageMeta()[f.rel]
    const parts: string[] = []
    if (meta?.w) parts.push(`${meta.w}×${meta.h}`)
    if (meta?.size !== undefined) {
      const size = meta.size >= 1048576 ? `${(meta.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(meta.size / 1024))} KB`
      parts.push(size)
    }
    parts.push(f.rel)
    return parts.join(" · ")
  }

  /** CSV/TSV 表格数据（含草稿缓冲；行/列/单元格上限在解析器内截断）。 */
  const tableData = createMemo(() => {
    const f = activeFile()
    if (!f || f.kind !== "table") return null
    const root = props.sessionDirectory
    const text = (root ? getDraft(root, f.rel) : undefined) ?? f.savedContent
    return parseCsv(text)
  })

  /** 当前文件源码文本（草稿优先，回退磁盘基准）——markdown/json 预览共用。 */
  const activeSourceText = createMemo(() => {
    const f = activeFile()
    if (!f) return ""
    const root = props.sessionDirectory
    return (root ? getDraft(root, f.rel) : undefined) ?? f.savedContent
  })

  /** djb2：Markdown 缓存键随内容变化（避免同 tab 内旧渲染被缓存命中）。 */
  /** 当前文件的批注反馈标记（pending → responded）。 */
  const fileMarks = () => {
    const f = activeFile()
    return props.sessionID && f ? marksFor(props.sessionID, f.rel) : []
  }

  /** 当前 Office kind（非 Office → null）。 */
  const officeKind = (): "xlsx" | "docx" | "pptx" | null => {
    const k = activeFile()?.kind
    return k === "xlsx" || k === "docx" || k === "pptx" ? k : null
  }

  const textHash = (s: string): number => {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return h >>> 0
  }

  function clearSelection() {
    setSel(null)
    setAnnotOpen(false)
    setQuoteSel(null)
    setQuoteOpen(false)
    setAnchorSel(null)
    setAnchorOpen(false)
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
    setFileVersion({})
    setImageMeta({})
    setSourceMode({})
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
    const kind = fileKindFor(rel)
    // 图片：不走 readFile（二进制闸），只需 root token + stat（元数据/版本）。
    if (kind === "image") {      const token = await fileProtocol.ensureRootToken(root)
      if (root !== props.sessionDirectory) return // root 已切换：丢弃迟到的结果
      if (!token) {
        setIoError("图片预览不可用（文件协议注册失败）")
        return
      }
      let version = Date.now()
      let size: number | undefined
      try {
        const st = await window.api.fs.statFile(root, rel)
        if (root !== props.sessionDirectory) return
        if (st.ok) {
          version = st.mtimeMs
          size = st.size
        }
      } catch { /* 元数据可选，失败仍可预览 */ }
      setFileVersion(prev => ({ ...prev, [rel]: version }))
      setImageMeta(prev => ({ ...prev, [rel]: { w: 0, h: 0, size } }))
      setModel(m => openFile(m, rel, "", true, "image"))
      setMode("edit")
      clearSelection()
      setIoError(null)
      void mountActive()
      return
    }
    // Office（xlsx/docx/pptx）：只读预览 tab；数据集走 mafw-file:// + fetch，不读文本。
    if (kind === "xlsx" || kind === "docx" || kind === "pptx") {
      const token = await fileProtocol.ensureRootToken(root)
      if (root !== props.sessionDirectory) return
      if (!token) {
        setIoError("Office 预览不可用（文件协议注册失败）")
        return
      }
      setFileVersion(prev => ({ ...prev, [rel]: Date.now() }))
      setModel(m => openFile(m, rel, "", true, kind))
      setMode("edit")
      clearSelection()
      setIoError(null)
      void mountActive()
      return
    }
    // SVG 默认预览需要协议 token（首次打开即渲染）；注册失败退回源码态。
    if (kind === "svg") {
      const token = await fileProtocol.ensureRootToken(root)
      if (root !== props.sessionDirectory) return
      if (!token) setSourceMode(prev => ({ ...prev, [rel]: true }))
    }
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (root !== props.sessionDirectory) return // root 已切换：丢弃迟到的结果（Important 2）
      const editorKind = kind === "svg" ? "svg" : kind === "table" ? "table" : kind === "markdown" ? "markdown" : kind === "json" ? "json" : "text"
      if (res.ok) {
        setMtime(root, rel, res.mtimeMs)
        setEol(root, rel, res.eol)
        setFileVersion(prev => ({ ...prev, [rel]: res.mtimeMs }))
        setModel(m => openFile(m, rel, res.content, false, editorKind))
      } else if (res.reason === "too-large" || res.reason === "binary" || res.reason === "encoding") {
        const note = res.reason === "binary" ? "二进制文件（只读）"
          : res.reason === "too-large" ? "文件超过 1MB（只读）"
            : "非 UTF-8 编码（只读，防保存损坏）"
        setReadNotes(prev => ({ ...prev, [rel]: note }))
        setModel(m => openFile(m, rel, "", true, editorKind))
      } else {
        setIoError(res.reason === "not-found" ? "文件不存在（可能已被移动/删除）" : "读取文件失败")
        return
      }
      setMode("edit")
      clearSelection()
      setIoError(null)
      void mountActive()
    } catch (e: any) {
      setIoError(`读取文件失败：${String(e?.message ?? e).slice(0, 60)}`)
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
    // 图片/Office 没有 CodeMirror：只挂外部变更 watch（变更 → 版本号刷新）。
    if (isReadOnlyPreview(f.kind)) {
      const key = `${root}\u0000${f.rel}`
      watched.add(key)
      void window.api.fs.watch(root, f.rel)
      return
    }
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
      setIoError(`编辑器加载失败：${String(e?.message ?? e).slice(0, 60)}`)
    }
  }

  onMount(() => {
    const off = window.api.fs.onChanged(({ root, rel }) => {
      if (root !== props.sessionDirectory) return
      const f = model().files.find(x => x.rel === rel)
      if (!f) return
      // 版本号对所有 kind 生效（图片/SVG 预览的缓存破坏；文本也会顺带更新预览图）
      setFileVersion(prev => ({ ...prev, [rel]: Date.now() }))
      if (isReadOnlyPreview(f.kind)) {
        // 图片/Office 只读：不读盘；图片重新 stat 大小，Office 仅版本号触发重解析
        if (f.kind === "image") {
          void window.api.fs.statFile(root, rel).then((st) => {
            if (root !== props.sessionDirectory || !st.ok) return
            setImageMeta(prev => ({ ...prev, [rel]: { ...prev[rel], size: st.size } }))
          })
        }
        return
      }
      if (f.readOnly) return
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
        setIoError(null)
      } else if (res.reason === "conflict") {
        setModel(m => onExternalChange(m, f.rel))
      } else if (res.reason === "not-found") {
        setIoError("文件已被删除，无法保存")
      } else {
        setIoError("保存失败")
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
      setIoError(res.reason === "not-found" ? "文件已被删除" : "读取失败")
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
    setSourceMode(prev => { const next = { ...prev }; delete next[rel]; return next })
    setImageMeta(prev => { const next = { ...prev }; delete next[rel]; return next })
    setFileVersion(prev => { const next = { ...prev }; delete next[rel]; return next })
    setMode("edit")
    clearSelection()
    void mountActive()
  }

  async function openExternal(rel: string) {
    const root = props.sessionDirectory
    if (!root) return
    const res = await window.api.fs.openExternal(root, rel)
    if (!res.ok) setIoError("无法在外部编辑器打开")
  }

  /** 预览面划选（md/docx）：选区落在 [data-annotatable="quote"] 内 → quote 锚 + 浮钮。 */
  function handlePreviewSelection(e: MouseEvent) {
    if (mode() !== "edit") return
    if (quoteOpen()) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setQuoteSel(null)
      return
    }
    const range = selection.getRangeAt(0)
    const target = e.target as HTMLElement | null
    const container = target?.closest?.('[data-annotatable="quote"]') as HTMLElement | null
    if (!container || !container.contains(range.commonAncestorContainer)) return
    const anchor = buildQuoteAnchor(container.innerText ?? "", selection.toString())
    if (!anchor) return
    const rect = range.getBoundingClientRect()
    const host = bodyEl?.getBoundingClientRect()
    if (!host) return
    setQuoteSel({
      anchor,
      left: Math.max(8, rect.left - host.left),
      top: Math.max(8, rect.bottom - host.top + 4),
    })
  }

  /** 表格单元格批注（csv/tsv）：事件委托，data-cell-ref 定位。 */
  function handleCellClick(e: MouseEvent) {
    if (mode() !== "edit") return
    const el = (e.target as HTMLElement)?.closest?.("[data-cell-ref]") as HTMLElement | null
    if (!el || !el.dataset.cellRef) return
    const host = bodyEl?.getBoundingClientRect()
    if (!host) return
    const rect = el.getBoundingClientRect()
    setAnchorSel({
      anchor: { kind: "cell", ref: el.dataset.cellRef, value: el.textContent ?? "" },
      left: Math.max(8, rect.left - host.left),
      top: Math.max(8, rect.bottom - host.top + 4),
    })
    setAnchorOpen(true)
  }

  /** 图片拖框：pointerdown/move/up（相对 region layer）。 */
  function onRegionDown(e: PointerEvent) {
    if (mode() !== "edit" || e.button !== 0) return
    const layer = e.currentTarget as HTMLElement
    const rect = layer.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    layer.setPointerCapture(e.pointerId)
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    dragStart = { x, y }
    setDrag({ x0: x, y0: y, x1: x, y1: y, w: rect.width, h: rect.height })
  }

  function onRegionMove(e: PointerEvent) {
    if (!dragStart) return
    const layer = e.currentTarget as HTMLElement
    const rect = layer.getBoundingClientRect()
    setDrag((d) =>
      d ? { ...d, x1: e.clientX - rect.left, y1: e.clientY - rect.top, w: rect.width, h: rect.height } : d,
    )
  }

  async function onRegionUp(e: PointerEvent) {
    if (!dragStart || !drag()) return
    const layer = e.currentTarget as HTMLElement
    const rect = layer.getBoundingClientRect()
    const px = dragRectPx(drag()!.x0, drag()!.y0, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
    dragStart = null
    if (!px) {
      setDrag(null)
      return
    }
    const norm: Rect01 = {
      x: px.left / rect.width,
      y: px.top / rect.height,
      w: px.w / rect.width,
      h: px.h / rect.height,
    }
    const img = layer.parentElement?.querySelector("img") as HTMLImageElement | null
    let imageDataUrl: string | undefined
    if (img) {
      try {
        imageDataUrl = await cropImageDataUrl(img, norm)
      } catch {
        /* 裁剪失败不阻塞文字批注 */
      }
    }
    const host = bodyEl?.getBoundingClientRect()
    setDrag(null)
    if (!host) return
    setAnchorSel({
      anchor: { kind: "region", ...norm },
      left: Math.max(8, Math.min(rect.left - host.left + px.left + px.w + 6, 420)),
      top: Math.max(8, rect.top - host.top + px.top + px.h + 6),
      imageDataUrl,
    })
    setAnchorOpen(true)
  }

  const selRange = () => {
    const s = sel()
    if (!s) return null
    return lineRangeOf(editor?.getDoc() ?? "", s.from, s.to)
  }

  /** 统一批注出口：anchor=undefined 走 CodeMirror 行号锚；有 anchor 走预览锚点。 */
  function submitAnnotationAnchored(
    anchor: AnnotationAnchor | undefined,
    comment: string,
    action: "draft" | "send",
    extra?: { imageDataUrl?: string },
  ) {
    const f = activeFile()
    if (!f || !comment.trim()) return
    if (anchor) {
      if (action === "send") {
        if (!props.onSendAnnotation) return
        props.onSendAnnotation(buildAnnotationPromptAnchored(f.rel, anchor, comment.trim()), extra)
        if (props.sessionID) addMark(props.sessionID, f.rel, anchor)
      } else {
        props.onAddAnnotation?.({
          rel: f.rel,
          startLine: 1,
          endLine: 1,
          code: "",
          comment: comment.trim(),
          anchor,
          imageDataUrl: extra?.imageDataUrl,
        })
      }
      setAnnotOpen(false)
      return
    }
    const s = sel()
    const range = selRange()
    if (!s || !range) return
    if (!annotationApplies(f.rel, s.rel)) { clearSelection(); return }
    if (action === "send") {
      if (!props.onSendAnnotation) return
      props.onSendAnnotation(buildAnnotationPrompt(f.rel, range.startLine, range.endLine, s.text, comment.trim()))
      if (props.sessionID) addMark(props.sessionID, f.rel)
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
      <DockPanelHeader title="编辑器">
        <TooltipV2 value="保存（Ctrl+S）" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="保存"
            disabled={!activeFile() || !!activeFile()?.readOnly || saving()}
            onClick={() => void saveActive()}
          >
            <Icon name="save" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="在外部编辑器打开" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="外部编辑器"
            disabled={!activeFile()}
            onClick={() => { const f = activeFile(); if (f) void openExternal(f.rel) }}
          >
            <Icon name="square-arrow-top-right" size="small" />
          </ButtonV2>
        </TooltipV2>
        <Show when={activeFile()?.kind === "svg" || activeFile()?.kind === "table" || activeFile()?.kind === "markdown" || activeFile()?.kind === "json"}>
          <TooltipV2 value={previewing() ? "查看源码" : activeFile()?.kind === "table" ? "表格视图" : activeFile()?.kind === "markdown" ? "渲染 Markdown" : activeFile()?.kind === "json" ? "JSON 树视图" : "预览 SVG"} openDelay={300}>
            <ButtonV2
              variant={previewing() ? "contrast" : "ghost"}
              size="small"
              aria-label={activeFile()?.kind === "table" ? "表格预览" : activeFile()?.kind === "markdown" ? "Markdown 预览" : activeFile()?.kind === "json" ? "JSON 树" : "SVG 预览"}
              aria-pressed={previewing()}
              onClick={togglePreview}
            >
              {previewToggleLabel()}
            </ButtonV2>
          </TooltipV2>
        </Show>
        <Show when={activeFile() && diffEntryFor(props.diffs, activeFile()!.rel)}>
          <TooltipV2 value={mode() === "diff" ? "返回编辑" : "查看改动"} openDelay={300}>
            <ButtonV2
              variant={mode() === "diff" ? "contrast" : "ghost"}
              size="small"
              aria-label="改动"
              onClick={() => { setMode(mode() === "diff" ? "edit" : "diff"); clearSelection() }}
            >
              <Icon name="review" size="small" />
            </ButtonV2>
          </TooltipV2>
        </Show>
      </DockPanelHeader>

      <Show when={ioError()}>
        <DockBanner kind="error" text={ioError()!} action={{ label: "关闭", onClick: () => setIoError(null) }} />
      </Show>

      <Show
        when={model().files.length > 0}
        fallback={<DockEmpty icon="file-tree" text="从「文件」面板选择文件打开" hint="单击文件即可在此编辑" />}
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
                ><Icon name="close-small" size="small" /></span>
              </div>
            )}
          </For>
        </div>

        {/* 冲突横幅：dirty + 磁盘已变（watch 或保存校验）→ 绝不静默覆盖 */}
        <Show when={activeFile()?.conflict}>
          <DockBanner kind="warn" text="磁盘已被改动（可能被 agent 修改）">
            <ButtonV2 variant="outline" size="small" onClick={() => { const f = activeFile(); if (f) void saveActive(true) }}>覆盖保存</ButtonV2>
            <ButtonV2 variant="ghost" size="small" onClick={() => { const f = activeFile(); if (f) keepMine(f.rel) }}>保留我的修改</ButtonV2>
            <ButtonV2 variant="ghost" size="small" onClick={() => { const f = activeFile(); if (f) void reloadFromDisk(f.rel) }}>重新加载</ButtonV2>
          </DockBanner>
        </Show>

        {/* 只读原因（binary/超大/非 UTF-8） */}
        <Show when={activeFile() && noteFor(activeFile()!.rel)}>
          <DockBanner kind="info" text={noteFor(activeFile()!.rel)!} />
        </Show>

        <div
          class="mafw-editor-body"
          ref={(el) => { bodyEl = el }}
          onMouseUp={handlePreviewSelection}
          onKeyDown={(e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.code !== "KeyM" || mode() !== "edit") return
            if (sel() && !annotOpen()) {
              e.preventDefault()
              e.stopPropagation()
              setAnnotOpen(true)
            } else if (quoteSel() && !quoteOpen()) {
              e.preventDefault()
              e.stopPropagation()
              setQuoteOpen(true)
            }
          }}
        >
          <div
            class="mafw-editor-host"
            ref={(el) => { host = el }}
            style={{ display: mode() === "diff" || previewing() ? "none" : "block" }}
          />

          {/* 文件预览（图片只读 / SVG 预览态）：host 保持挂载，仅隐藏 */}
          <Show when={previewing() && activeFile() && activeFile()!.kind !== "table" && activeFile()!.kind !== "markdown" && activeFile()!.kind !== "json" && !officeKind()}>
            <div class="mafw-file-preview">
              <div class="mafw-file-preview-canvas">
                <img
                  class="mafw-file-preview-img"
                  crossOrigin="anonymous"
                  src={previewUrl(activeFile()!.rel)}
                  alt={activeFile()!.rel}
                  onLoad={(e) => recordImageDims(activeFile()!.rel, e.currentTarget)}
                />
                <Show when={mode() === "edit"}>
                  <div
                    class="mafw-region-layer"
                    aria-label="拖框批注区域"
                    onPointerDown={onRegionDown}
                    onPointerMove={onRegionMove}
                    onPointerUp={onRegionUp}
                  >
                    <Show when={drag()}>
                      <div
                        class="mafw-region-rect"
                        style={{
                          left: `${Math.min(drag()!.x0, drag()!.x1)}px`,
                          top: `${Math.min(drag()!.y0, drag()!.y1)}px`,
                          width: `${Math.abs(drag()!.x1 - drag()!.x0)}px`,
                          height: `${Math.abs(drag()!.y1 - drag()!.y0)}px`,
                        }}
                      />
                    </Show>
                  </div>
                </Show>
                <For each={fileMarks().filter((m) => m.anchor?.kind === "region")}>
                  {(m) => {
                    const a = m.anchor as Extract<AnnotationAnchor, { kind: "region" }>
                    return (
                      <div
                        class="mafw-annot-pin"
                        classList={{ "mafw-annot-pin-pending": m.status === "pending" }}
                        style={{ left: `${(a.x + a.w / 2) * 100}%`, top: `${(a.y + a.h / 2) * 100}%` }}
                        aria-label={m.status === "pending" ? "批注处理中" : "批注已回应"}
                        onClick={() => props.onOpenReview?.()}
                      />
                    )
                  }}
                </For>
              </div>
              <div class="mafw-file-preview-meta">{previewMeta(activeFile()!)}</div>
            </div>
          </Show>

          {/* CSV/TSV 表格预览（只读；源码一键切换） */}
          <Show when={previewing() && activeFile()?.kind === "table"}>
            <Show
              when={tableData()?.rows.length}
              fallback={<DockEmpty icon="file-tree" text="空表格" hint="源码态可直接编辑" />}
            >
              <div class="mafw-table-preview" onClick={handleCellClick}>
                <table class="mafw-table">
                  <thead>
                    <tr>
                      <For each={tableData()!.rows[0]}>{(cell, i) => <th data-cell-ref={a1Ref(1, i() + 1)}>{cell}</th>}</For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={tableData()!.rows.slice(1)}>
                      {(r, ri) => (
                        <tr>
                          <For each={tableData()!.rows[0]}>
                            {(_, i) => <td data-cell-ref={a1Ref(ri() + 2, i() + 1)}>{r[i()] ?? ""}</td>}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <Show when={tableData()!.truncated}>
                  <div class="mafw-table-note">已截断（上限：行 500 / 列 50 / 单元格 200 字符）</div>
                </Show>
              </div>
            </Show>
          </Show>

          {/* Markdown 渲染预览（聊天同款 renderer：sanitize + 代码高亮） */}
          <Show when={previewing() && activeFile()?.kind === "markdown"}>
            <div class="mafw-md-preview" data-annotatable="quote">
              <Markdown
                text={activeSourceText()}
                cacheKey={`md:${activeFile()!.rel}:${textHash(activeSourceText())}`}
                streaming={false}
              />
            </div>
          </Show>

          {/* JSON 树预览（可折叠；源码一键切换） */}
          <Show when={previewing() && activeFile()?.kind === "json"}>
            <div class="mafw-json-preview-wrap">
              <JsonPreview
                text={activeSourceText()}
                onAnnotate={(path, summary, rect) => {
                  const host = bodyEl?.getBoundingClientRect()
                  if (!host) return
                  setAnchorSel({
                    anchor: { kind: "jsonPath", path: jsonPathOf(path), valueSummary: summary },
                    left: Math.max(8, rect.left - host.left),
                    top: Math.max(8, rect.bottom - host.top + 4),
                  })
                  setAnchorOpen(true)
                }}
              />
            </div>
          </Show>

          {/* Office 预览（xlsx/docx/pptx；解析库懒加载） */}
          <Show when={previewing() && activeFile() && officeKind()}>
            <OfficePreview
              kind={officeKind()!}
              url={previewUrl(activeFile()!.rel)}
              rel={activeFile()!.rel}
              onOpenExternal={() => { const f = activeFile(); if (f) void openExternal(f.rel) }}
              onAnnotateCell={(a, rect) => {
                const host = bodyEl?.getBoundingClientRect()
                if (!host) return
                setAnchorSel({
                  anchor: { kind: "cell", ...a },
                  left: Math.max(8, rect.left - host.left),
                  top: Math.max(8, rect.bottom - host.top + 4),
                })
                setAnchorOpen(true)
              }}
              onAnnotateRegion={(a, point) => {
                const host = bodyEl?.getBoundingClientRect()
                if (!host) return
                setAnchorSel({
                  anchor: { kind: "region", ...a },
                  left: Math.max(8, point.clientX - host.left),
                  top: Math.max(8, point.clientY - host.top),
                })
                setAnchorOpen(true)
              }}
            />
          </Show>

          {/* 批注反馈标记条（回路闭合：待回应 → 已回应，点击进审阅） */}
          <Show when={fileMarks().length > 0}>
            <div class="mafw-annot-marks">
              <For each={fileMarks()}>
                {(m) => (
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-annot-mark"
                    onClick={() => props.onOpenReview?.()}
                  >
                    <span class="mafw-annot-mark-dot" data-status={m.status} aria-hidden="true" />
                    <span>{m.anchor ? describeAnchor(m.anchor) : "文本批注"} · {m.status === "pending" ? "待回应" : "已回应"}</span>
                  </ButtonV2>
                )}
              </For>
            </div>
          </Show>

          {/* 选区批注入口（人标出 → agent 改）：浮钮为发现性入口，Ctrl+M 直达 */}
          <Show when={mode() === "edit" && sel() && !annotOpen() && props.onSendAnnotation}>
            <div class="mafw-editor-annot-anchor" style={{ left: `${Math.max(8, sel()!.left)}px`, top: `${sel()!.top + 4}px` }}>
              <ButtonV2 variant="outline" size="small" onMouseDown={(e: MouseEvent) => e.preventDefault()} onClick={() => setAnnotOpen(true)}>批注</ButtonV2>
            </div>
          </Show>
          <Show when={mode() === "edit" && annotOpen() && sel()}>
            <AnnotationPopover
              left={Math.max(8, Math.min(sel()!.left, 420))}
              top={sel()!.top + 4}
              meta={`${sel()!.rel}:L${selRange()?.startLine}-${selRange()?.endLine}`}
              placeholder="说明要改什么…"
              onSubmit={(comment, action) => submitAnnotationAnchored(undefined, comment, action)}
              onCancel={() => setAnnotOpen(false)}
            />
          </Show>

          {/* 预览划选批注（md/docx）：浮钮 → 就地输入 → Enter 发送 */}
          <Show when={mode() === "edit" && quoteSel() && !quoteOpen() && props.onSendAnnotation}>
            <div class="mafw-editor-annot-anchor" style={{ left: `${quoteSel()!.left}px`, top: `${quoteSel()!.top}px` }}>
              <ButtonV2 variant="outline" size="small" onMouseDown={(e: MouseEvent) => e.preventDefault()} onClick={() => setQuoteOpen(true)}>批注</ButtonV2>
            </div>
          </Show>
          <Show when={mode() === "edit" && quoteOpen() && quoteSel()}>
            <AnnotationPopover
              left={Math.min(quoteSel()!.left, 420)}
              top={quoteSel()!.top}
              meta={`${activeFile()?.rel ?? ""}: 节选`}
              placeholder="这段要改成什么…"
              onSubmit={(comment, action) => {
                submitAnnotationAnchored(quoteSel()?.anchor, comment, action)
                setQuoteOpen(false)
                setQuoteSel(null)
              }}
              onCancel={() => { setQuoteOpen(false); setQuoteSel(null) }}
            />
          </Show>

          <Show when={mode() === "edit" && anchorOpen() && anchorSel()}>
            <AnnotationPopover
              left={Math.min(anchorSel()!.left, 420)}
              top={anchorSel()!.top}
              meta={`${activeFile()?.rel ?? ""} › ${describeAnchor(anchorSel()!.anchor)}`}
              placeholder="这处要改成什么…"
              onSubmit={(comment, action) => {
                submitAnnotationAnchored(anchorSel()?.anchor, comment, action, { imageDataUrl: anchorSel()?.imageDataUrl })
                setAnchorOpen(false)
                setAnchorSel(null)
              }}
              onCancel={() => { setAnchorOpen(false); setAnchorSel(null) }}
            />
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
                allowSessionFallback={false}
                allowNonInvertibleRevert={false}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
