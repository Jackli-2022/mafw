// EditorDock：RightDock「编辑器」tab —— 人机协同编辑器（spec §5.2）。
// - 打开文件（焦点栈 openRequest / 左侧文件树）→ CodeMirror 6；
// - VSCode 式保存（Ctrl+S / 保存按钮，显式写盘；dirty 缓冲不自动落盘）；
// - 外部改动（agent 改了同一文件）：干净 → 静默刷新；dirty → 冲突横幅（绝不静默覆盖）；
// - 保存时 mtime 版本校验（调研 §3 防线②）：磁盘已变 → 冲突，覆盖需显式选择；
// - 草稿/基准存 editor-drafts（root-scoped 模块单例）：卸载（关 dock/connDown）不丢。
import { createSignal, createEffect, createMemo, onCleanup, onMount, untrack, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { CheckboxV2 } from "@mafw/ui/v2/checkbox-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { menuController } from "../context-menu/controller"
import { buildEditorTabMenu } from "../context-menu/builders/editor-tab"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { Icon } from "@mafw/ui/icon"
import { DockBanner, DockEmpty } from "./dock-panel"
import { DocumentFrame, DocumentTabs, DocumentToolbar } from "./document-frame"
import { editorDocumentTabs } from "../document-frame-model"
import { activeDocumentTab, configureFileDocumentRoot, consumeCloseRequest, pendingCloseRequests } from "../documents/document-tabs-store"
import { registerDocumentToolbar, type DocumentToolbarSlots } from "../documents/document-toolbar-registry"
import {
  openFile, openPreviewFile, closeFile, setActive,
  markDirty, markSaved, onExternalChange, resolveConflict, applyCleanReload, canApplyCleanReload,
  editorSaveContent, isReadOnlyPreview, promotePreview,
  type EditorModel, type OpenFile,
} from "../editor-state"
import { fileModelFor, saveFileModel } from "../documents/file-documents"
import {
  contentScopeStateFor,
  readingPositionFor,
  rememberReadingPosition,
  rememberSelection,
  saveContentScopeState,
  selectTreeFile,
  selectionFor,
} from "../content-scope-state"
import {
  clearDraft, getDraft, getEol, getMtime, setDraft, setEol, setMtime,
} from "../editor-drafts"
import { fileKindFor } from "../file-kind"
import { fileProtocol } from "../file-protocol-client"
import { parseCsv } from "../csv-parse"
import { Markdown } from "@mafw/session-ui/markdown"
import { JsonPreview } from "./JsonPreview"
import { OfficePreview } from "./OfficePreview"
import { langForFile } from "../editor/cm-lang"
import { mountEditor, type MountedEditor } from "../editor/mount-editor"
import { annotationApplies, lineRangeOf } from "../editor-annotation"
import { activationRefreshAction } from "../editor-activation"
import { inlineDiffRanges } from "../editor/inline-diff"
import { diffEntryFor } from "../editor-diff"
import { AnnotationSheet } from "./AnnotationSheet"
import { InlineEditSheet } from "./InlineEditSheet"
import type { InlineEditSubmission } from "../editor/inline-edit"
import { buildQuoteAnchor } from "../quote-anchor"
import { pushComposerInsert } from "../composer-insert"
import { buildFileQuote } from "../file-quote"
import { describeAnchor, jsonPathOf, a1Ref } from "../annotation-anchor"
import { dragRectPx, cropImageDataUrl, type Rect01 } from "../region-capture"
import { addMark, clearMarks, marksFor, marksForSession, removeMarkByAnnotation, type MarkVisual } from "../annotation-marks"
import { draftsFor, removePending, setAnnotationHeld } from "../annotation-store"
import { annotationInScope, annotationSourceFromScopeKey } from "../annotation-scope"
import { textFingerprint } from "../annotation-source"
import { placeSelectionToolbar } from "../annotation-selection"
import { lineHighlightsFor } from "../annotation-highlight"
import {
  clearQuoteHighlights,
  findQuoteRange,
  quoteHighlightRange,
  quoteHighlightState,
  removeQuoteHighlight,
  setQuoteHighlight,
  supportsQuoteHighlights,
  updateQuoteHighlightState,
} from "../annotation-highlights"
import { isAnnotationHotkey } from "../annotation-hotkey"
import type { Annotation, AnnotationAnchor, AnnotationSource } from "../../../shared/annotation-types"
import type { FileDiffEntry } from "./DiffReviewPanel"
import { openModeForTab } from "../content-intent"
import type { FocusOpenRequest } from "../focus/focus-open"

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
  /** Local draft/mark owner; falls back to sessionID for legacy callers. */
  annotationOwnerKey?: string | null
  contentRoot: string | null
  scopeKey?: string | null
  /** 统一文档舞台内嵌：不渲染自己的 tab 条。 */
  embedded?: boolean
  /** 活动文档 → 内容 surface 标签直接显示文档名。 */
  onActiveFileChange?: (rel: string | null) => void
  /** 焦点栈驱动的显式打开请求；back / crumb / restore 都落在这里。 */
  openRequest?: FocusOpenRequest | null
  diffs?: FileDiffEntry[]
  /** 加入批注草稿（v2：草稿优先，发送时随消息打包） */
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
    anchor?: AnnotationAnchor
    imageDataUrl?: string
    scopeKey?: string
    root?: string
    source?: AnnotationSource
    contentVersion?: string | null
    capturedDirty?: boolean
  }) => Annotation | void
  onSendComment?: (sid: string, text: string) => void
  /** AI 编辑：选区 + 指令交给 agent 改文件；Desktop 不直接应用模型文本。 */
  onInlineEdit?: (input: InlineEditSubmission) => void
  /** 批注标记点击 → 切到审阅面（回路闭合）。 */
  onOpenReview?: () => void
  /** 显式讨论/处理当前文件的批注草稿。 */
  onDiscussAnnotations?: (items: Annotation[]) => void
}) {
  const model = () => fileModelFor(props.contentRoot)
  const setModel = (update: EditorModel | ((current: EditorModel) => EditorModel)) => {
    const current = fileModelFor(props.contentRoot)
    const next = typeof update === "function" ? update(current) : update
    saveFileModel(props.contentRoot, next)
  }
  const [readNotes, setReadNotes] = createSignal<Record<string, string>>({})
  const [saving, setSaving] = createSignal(false)
  const [sel, setSel] = createSignal<SelectionState | null>(null)
  const [annotOpen, setAnnotOpen] = createSignal(false)
  const [inlineEditOpen, setInlineEditOpen] = createSignal(false)
  /** 选区浮动 toolbar（ADE 模式）：选中只出现「引用 / 批注」，不自动打开表单。 */
  const [selectionBar, setSelectionBar] = createSignal<{ left: number; top: number; kind: "source" | "quote" } | null>(null)
  /** 当前高亮的批注（margin card 点击 → active 态）。 */
  const [activeAnnotationID, setActiveAnnotationID] = createSignal<string | null>(null)
  /** 选区已被 composer 消费：避免关闭 composer 时 selectionchange 又把 toolbar 弹回来。 */
  const [selectionConsumed, setSelectionConsumed] = createSignal(false)
  /** 预览划选批注（md/docx）：锚点 + 浮层坐标（相对 editor-body）。 */
  const [quoteSel, setQuoteSel] = createSignal<{
    anchor: AnnotationAnchor
    left: number
    top: number
    rects: { x: number; y: number; w: number; h: number }[]
    box: { left: number; top: number; width: number; height: number }
    range?: Range
  } | null>(null)
  const [quoteOpen, setQuoteOpen] = createSignal(false)
  /** 预览锚点批注（json 节点 / 表格单元格 / 图片区域 / pptx 图钉）：标记即输入。 */
  const [anchorSel, setAnchorSel] = createSignal<{
    anchor: AnnotationAnchor
    left: number
    top: number
    box: { left: number; top: number; width: number; height: number }
    imageDataUrl?: string
  } | null>(null)
  const [anchorOpen, setAnchorOpen] = createSignal(false)
  /** 图片拖框（region 批注）：px 坐标 + 图片盒尺寸。 */
  const [drag, setDrag] = createSignal<{ x0: number; y0: number; x1: number; y1: number; w: number; h: number } | null>(null)
  let dragStart: { x: number; y: number } | null = null
  let bodyEl: HTMLDivElement | undefined
  const IS_MAC = /Mac/.test(globalThis.navigator?.platform ?? "")
  let marksOwner: string | null = null
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
  let mountedRoot: string | null = null
  let mountedRel: string | null = null
  let mountToken = 0
  let lastScopeKey: string | null = props.scopeKey ?? null
  let previewRestoredKey: string | null = null
  /** 初始恢复活动文档期间，禁止空的 editor model 覆盖持久化状态。 */
  let restoringActive = false
  /** 用户显式关闭最后一个 tab 后才允许把持久化 activeFile 清空。 */
  let allowEmptyPersist = false
  /** setDoc 程序化写入期间抑制 markDirty。 */
  let applyingExternal = false
  /** 已 watch 的 (root, rel)；root 变化时用旧 root 退订。 */
  const watched = new Set<string>() // `${root}\u0000${rel}`

  const activeFile = (): OpenFile | null =>
    model().files.find(f => f.rel === model().active) ?? null

  // 通知 shell：内容 surface 的标签用当前文档名，而不是泛化的「文件」。
  createEffect(() => {
    props.onActiveFileChange?.(activeFile()?.rel ?? null)
  })

  const previewScrollPort = (): HTMLElement | null => {
    if (!bodyEl) return null
    return bodyEl.querySelector<HTMLElement>(
      ".mafw-md-preview, .mafw-json-preview-wrap, .mafw-table-preview, .mafw-office-host",
    )
  }

  const rememberScrollForModel = (m: EditorModel, key: string | null): void => {
    const file = m.files.find((f) => f.rel === m.active) ?? null
    if (!file) return
    const top = previewingFile(file) ? previewScrollPort()?.scrollTop : editor?.getScroll()
    if (top === undefined) return
    const withPosition = rememberReadingPosition(contentScopeStateFor(key), file.rel, top)
    saveContentScopeState(
      key,
      rememberSelection(withPosition, file.rel, editor?.getSelection() ?? null),
    )
  }
  const rememberActiveScroll = (key: string | null = props.scopeKey ?? null): void => {
    rememberScrollForModel(model(), key)
  }

  const tabs = createMemo(() => editorDocumentTabs(model()))

  const activateRel = (rel: string) => {
    rememberActiveScroll()
    setModel(m => setActive(m, rel))
    clearSelection()
    void mountActive()
  }

  // 文件 entries 由 file-documents + document store 自动派生。
  createEffect(() => {
    configureFileDocumentRoot(props.contentRoot)
  })

  // 统一 tab 条选中的文件：只激活，不重新读盘。
  createEffect(() => {
    const active = activeDocumentTab()
    if (!active || active.kind !== "file") return
    if (active.view.id !== model().active) activateRel(active.view.id)
  })

  // 共享 tab 条发来的关闭请求：只消费属于本 root 的 file id。
  createEffect(() => {
    const root = props.contentRoot
    if (!root) return
    const prefix = `file:${root}\u0000`
    for (const id of pendingCloseRequests()) {
      if (!id.startsWith(prefix)) continue
      consumeCloseRequest(id)
      closeRel(id.slice(prefix.length))
    }
  })

  const noteFor = (rel: string) => readNotes()[rel]

  /** mafw-file:// URL（带版本号破缓存）；token 未就绪 → 空串（<img> 不渲染）。 */
  const previewUrl = (rel: string): string => {
    const root = props.contentRoot
    return (root && fileProtocol.urlFor(root, rel, fileVersion()[rel])) ?? ""
  }

  /** 活动文件的预览 URL。按值去抖：props.contentRoot 上游会随 sessions 信号抖动，
   *  裸 getter 会让 OfficePreview 的解析 effect 重跑（清空宿主 → 白帧，2026-10-31）。 */
  const activePreviewUrl = createMemo(() => {
    const f = activeFile()
    return f ? previewUrl(f.rel) : ""
  })

  // ── 内联 diff（2026-10-31）：agent 改动行装饰 + 上一处/下一处 ─────────
  const activeDiffEntry = createMemo(() => {
    const f = activeFile()
    return f ? diffEntryFor(props.diffs, f.rel) : null
  })
  const inlineRanges = createMemo(() => inlineDiffRanges(activeDiffEntry()?.patch))
  const [inlineIndex, setInlineIndex] = createSignal(0)
  const gotoInlineChange = (delta: number) => {
    const ranges = inlineRanges()
    if (!ranges.length || !editor) return
    const next = (inlineIndex() + delta + ranges.length) % ranges.length
    setInlineIndex(next)
    editor.gotoLine(ranges[next].from)
  }

  /** 预览态：图片恒预览；svg / csv-tsv / markdown / json 默认预览（仅显式源码态例外）。 */
  const showsPreview = (f: OpenFile): boolean => {
    if (f.kind === "svg" || f.kind === "table" || f.kind === "markdown" || f.kind === "json") return sourceMode()[f.rel] !== true
    return false
  }
  const previewingFile = (f: OpenFile | null): boolean => {
    if (!f) return false
    if (isReadOnlyPreview(f.kind)) return true
    return showsPreview(f)
  }
  const previewing = (): boolean => previewingFile(activeFile())

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
    const root = props.contentRoot
    const text = (root ? getDraft(root, f.rel) : undefined) ?? f.savedContent
    return parseCsv(text)
  })

  /** 当前文件源码文本（草稿优先，回退磁盘基准）——markdown/json 预览共用。 */
  const activeSourceText = createMemo(() => {
    const f = activeFile()
    if (!f) return ""
    const root = props.contentRoot
    return (root ? getDraft(root, f.rel) : undefined) ?? f.savedContent
  })

  /** djb2：Markdown 缓存键随内容变化（避免同 tab 内旧渲染被缓存命中）。 */
  const annotationOwner = () => props.annotationOwnerKey ?? props.sessionID ?? ""
  const markOwner = () => `${annotationOwner()}::${props.scopeKey ?? ""}`

  /** 当前文件的批注反馈标记（pending → responded）。 */
  const fileMarks = () => {
    const f = activeFile()
    return markOwner() && f ? marksFor(markOwner(), f.rel) : []
  }

  /** 当前文件、当前作用域的待处理批注（ADE margin card 的数据源）。 */
  const fileAnnotations = () => {
    const f = activeFile()
    if (!annotationOwner() || !f) return []
    return draftsFor(annotationOwner()).filter((a) =>
      a.rel === f.rel
      && !a.discussedAt
      && !a.delegatedAt
      && annotationInScope(a, props.scopeKey, props.contentRoot))
  }

  const annotationByID = () => new Map(fileAnnotations().map((a) => [a.id, a] as const))

  const markStatus = (m: { annotationID?: string; status: "pending" | "responded" }) => {
    const a = m.annotationID ? annotationByID().get(m.annotationID) : undefined
    if (a?.held) return "held"
    return m.status === "pending" ? "pending" : "responded"
  }

  const quoteOfAnnotation = (a: Annotation) => {
    if (a.anchor?.kind === "quote") return a.anchor.quote
    if (a.anchor?.kind === "jsonPath") return a.anchor.path
    if (a.anchor?.kind === "cell") return `${a.anchor.ref} · ${a.anchor.value}`
    if (a.anchor?.kind === "region") return `区域 ${Math.round(a.anchor.x * 100)}%,${Math.round(a.anchor.y * 100)}%`
    return a.code || `第 ${a.startLine} 行`
  }

  const locationOfAnnotation = (a: Annotation) => {
    if (a.anchor) return `${a.rel} · ${describeAnchor(a.anchor)}`
    return `${a.rel} · L${a.startLine}${a.endLine !== a.startLine ? `–${a.endLine}` : ""}`
  }

  function focusAnnotation(a: Annotation) {
    setActiveAnnotationID(a.id)
    const qr = quoteHighlightRange(a.id)
    if (qr) {
      const r = qr.getBoundingClientRect()
      const host = bodyEl?.getBoundingClientRect()
      if (host) {
        revealAnchor({
          left: r.left - host.left,
          top: r.top - host.top,
          width: Math.max(1, r.width),
          height: Math.max(1, r.height),
        })
        return
      }
    }
    const mark = fileMarks().find((m) => m.annotationID === a.id)
    const rect = mark?.visual?.rects?.[0]
    const point = mark?.visual?.point
    const box = rect
      ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
      : point
        ? { left: Math.max(0, point.x - 6), top: Math.max(0, point.y - 6), width: 12, height: 12 }
        : null
    if (box) revealAnchor(box)
  }

  function dropAnnotation(a: Annotation) {
    removePending(a.sessionID, a.id)
    removeMarkByAnnotation(a.sessionID, a.id)
    removeQuoteHighlight(a.id)
    if (activeAnnotationID() === a.id) setActiveAnnotationID(null)
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
    setSelectionBar(null)
    setActiveAnnotationID(null)
    setDrag(null)
    dragStart = null
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

  // ── root/scope 跟随：切换 root 时重建 editor，模型由 file-documents 持有 ───
  let lastFileRoot: string | null | undefined
  let lastFileScope: string | null | undefined
  createEffect(() => {
    const root = props.contentRoot
    const scopeKey = props.scopeKey ?? null
    if (lastFileRoot === root && lastFileScope === scopeKey) return
    const previousRoot = lastFileRoot
    const previousScope = lastScopeKey
    lastFileRoot = root
    lastFileScope = scopeKey
    if (previousRoot !== undefined) {
      untrack(() => rememberScrollForModel(fileModelFor(previousRoot), previousScope))
    }
    // 旧 editor 必须在模型/根切换前同步失效，避免 refreshActiveFromDisk 的
    // await 窗口里 saveActive 把旧文档写进新 scope 的同名文件。
    mountToken += 1
    editor?.destroy()
    editor = null
    mountedRoot = null
    mountedRel = null
    previewRestoredKey = null
    lastScopeKey = scopeKey
    const restored = fileModelFor(root)
    const activeRel = scopeKey ? contentScopeStateFor(scopeKey).activeFile : null
    const shouldRestore = !!root && restored.files.length === 0 && !!activeRel
    // 必须在 setModel 之前置位：Solid 可能同步触发 model effect，空模型会覆盖持久化状态。
    restoringActive = shouldRestore
    setModel(restored)
    setReadNotes({})
    setFileVersion({})
    setImageMeta({})
    setSourceMode({})
    setIoError(null)
    clearSelection()
    void unwatchAll()
    if (shouldRestore && activeRel) {
      void openRel(activeRel).finally(() => { restoringActive = false })
    } else {
      untrack(() => { void mountActive() })
    }
  })

  createEffect(() => {
    const current = model()
    const key = props.scopeKey ?? null
    if (current.root) saveFileModel(current.root, current)
    if (!key) return
    // 初始挂载时 contentRoot 尚未就绪：空 model 绝不能覆盖上一次持久化的 activeFile。
    if (!current.root || current.root !== props.contentRoot) return
    const scopeState = contentScopeStateFor(key)
    if (restoringActive && current.files.length === 0) return
    if (current.files.length === 0 && !allowEmptyPersist && scopeState.activeFile) return
    saveContentScopeState(key, {
      ...selectTreeFile(scopeState, current.active),
      openFiles: current.files.map((file) => file.rel),
      activeFile: current.active,
    })
  })

  // 预览面（markdown/json/table/office）有自己的滚动容器，按 scope/file 恢复。
  createEffect(() => {
    const file = activeFile()
    const key = props.scopeKey ?? null
    if (!file || !previewing()) {
      previewRestoredKey = null
      return
    }
    const id = `${key}\u0000${file.rel}`
    if (previewRestoredKey === id) return
    previewRestoredKey = id
    const restore = () => {
      const port = previewScrollPort()
      if (!port) return
      port.scrollTop = readingPositionFor(contentScopeStateFor(key), file.rel) ?? 0
    }
    queueMicrotask(restore)
    requestAnimationFrame(restore)
  })

  // M2：会话切换时清掉上一会话的批注标记，防止 renderer 生命周期内累积。
  createEffect(() => {
    const sid = props.sessionID
    if (sid === marksOwner) return
    if (marksOwner) clearMarks(marksOwner)
    marksOwner = sid
  })

  // ── 焦点栈显式打开请求：back / crumb / restore 都能落到位 ──
  let lastExplicitOpen = 0
  createEffect(() => {
    const req = props.openRequest
    if (!req) return
    if (req.root !== props.contentRoot) return
    if (req.nonce === lastExplicitOpen) return
    lastExplicitOpen = req.nonce
    void openRel(req.rel, { persist: req.persist === true }).then(() => {
      if (req.line === undefined) return
      requestAnimationFrame(() => {
        if (req.nonce === props.openRequest?.nonce) editor?.gotoLine(req.line!)
      })
    })
  })

  /** 普通打开 → 临时预览（不堆 tab）；显式 persist → 持久 tab。 */
  const openModelFile = (
    m: EditorModel,
    rel: string,
    content: string,
    readOnly: boolean,
    kind: OpenFile["kind"],
    persist = false,
  ): EditorModel => {
    const mode = openModeForTab({ persist })
    const next = mode === "persistent"
      ? openFile(m, rel, content, readOnly, kind)
      : openPreviewFile(m, rel, content, readOnly, kind)
    // 跨重启草稿：有草稿的文件恢复后必须标 dirty 并转持久 Tab，避免下一次预览替换掉。
    const root = props.contentRoot
    return root && getDraft(root, rel) !== undefined ? markDirty(next, rel) : next
  }

  async function openRel(rel: string, opts: { persist?: boolean } = {}) {
    const root = props.contentRoot
    if (!root) return
    allowEmptyPersist = false
    rememberActiveScroll()
    if (model().files.some(f => f.rel === rel)) {
      setModel(m => {
        const promoted = opts.persist === true ? promotePreview(m, rel) : m
        return setActive(promoted, rel)
      })
      clearSelection()
      void mountActive()
      return
    }
    const kind = fileKindFor(rel)
    // 图片：不走 readFile（二进制闸），只需 root token + stat（元数据/版本）。
    if (kind === "image") {      const token = await fileProtocol.ensureRootToken(root)
      if (root !== props.contentRoot) return // root 已切换：丢弃迟到的结果
      if (!token) {
        setIoError("图片预览不可用（文件协议注册失败）")
        return
      }
      let version = Date.now()
      let size: number | undefined
      try {
        const st = await window.api.fs.statFile(root, rel)
        if (root !== props.contentRoot) return
        if (st.ok) {
          version = st.mtimeMs
          size = st.size
          setMtime(root, rel, st.mtimeMs)
        }
      } catch { /* 元数据可选，失败仍可预览 */ }
      setFileVersion(prev => ({ ...prev, [rel]: version }))
      setImageMeta(prev => ({ ...prev, [rel]: { w: 0, h: 0, size } }))
      setModel(m => openModelFile(m, rel, "", true, "image", opts.persist))
      clearSelection()
      setIoError(null)
      void mountActive({ fresh: true })
      return
    }
    // Office（xlsx/docx/pptx）：只读预览 tab；数据集走 mafw-file:// + fetch，不读文本。
    if (kind === "xlsx" || kind === "docx" || kind === "pptx") {
      const token = await fileProtocol.ensureRootToken(root)
      if (root !== props.contentRoot) return
      if (!token) {
        setIoError("Office 预览不可用（文件协议注册失败）")
        return
      }
      // 记录打开时 mtime：切回 tab 时 stat 比对，未变则不重解析（防白帧）
      try {
        const st = await window.api.fs.statFile(root, rel)
        if (root !== props.contentRoot) return
        if (st.ok) setMtime(root, rel, st.mtimeMs)
      } catch { /* 可选元数据 */ }
      setFileVersion(prev => ({ ...prev, [rel]: Date.now() }))
      setModel(m => openModelFile(m, rel, "", true, kind, opts.persist))
      clearSelection()
      setIoError(null)
      void mountActive({ fresh: true })
      return
    }
    // SVG 默认预览需要协议 token（首次打开即渲染）；注册失败退回源码态。
    if (kind === "svg") {
      const token = await fileProtocol.ensureRootToken(root)
      if (root !== props.contentRoot) return
      if (!token) setSourceMode(prev => ({ ...prev, [rel]: true }))
    }
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (root !== props.contentRoot) return // root 已切换：丢弃迟到的结果（Important 2）
      const editorKind = kind === "svg" ? "svg" : kind === "table" ? "table" : kind === "markdown" ? "markdown" : kind === "json" ? "json" : "text"
      if (res.ok) {
        setMtime(root, rel, res.mtimeMs)
        setEol(root, rel, res.eol)
        setFileVersion(prev => ({ ...prev, [rel]: res.mtimeMs }))
        setModel(m => openModelFile(m, rel, res.content, false, editorKind, opts.persist))
      } else if (res.reason === "too-large" || res.reason === "binary" || res.reason === "encoding") {
        const note = res.reason === "binary" ? "二进制文件（只读）"
          : res.reason === "too-large" ? "文件超过 1MB（只读）"
            : "非 UTF-8 编码（只读，防保存损坏）"
        setReadNotes(prev => ({ ...prev, [rel]: note }))
        setModel(m => openModelFile(m, rel, "", true, editorKind, opts.persist))
      } else {
        setIoError(res.reason === "not-found" ? "文件不存在（可能已被移动/删除）" : "读取文件失败")
        return
      }
      clearSelection()
      setIoError(null)
      void mountActive({ fresh: true })
    } catch (e: any) {
      setIoError(`读取文件失败：${String(e?.message ?? e).slice(0, 60)}`)
    }
  }

  // ── 激活刷新（2026-10-31）：后台 tab 期间不 watch，切回时按磁盘真值校验 ─────
  // 只读预览 → stat 比对 mtime，未变不 bump（防无谓重解析）；文本 → 读盘，
  // 干净时静默换基准，dirty 时只标冲突、绝不覆盖（沿用 canApplyCleanReload 语义）。
  async function refreshActiveFromDisk(rel: string) {
    const root = props.contentRoot
    if (!root) return
    const file = model().files.find((x) => x.rel === rel)
    if (!file) return
    const action = activationRefreshAction(file)
    if (action === "none") return
    if (action === "stat-preview") {
      try {
        const st = await window.api.fs.statFile(root, rel)
        if (root !== props.contentRoot || !st.ok) return
        if (getMtime(root, rel) === st.mtimeMs) return // 未变更：不重解析（否则切 tab 白一帧）
        setMtime(root, rel, st.mtimeMs)
        setFileVersion(prev => ({ ...prev, [rel]: Date.now() }))
        if (file.kind === "image") {
          setImageMeta(prev => ({ ...prev, [rel]: { ...prev[rel], size: st.size } }))
        }
      } catch { /* fail-open：保留现状 */ }
      return
    }
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (root !== props.contentRoot || !res.ok) return
      const now = model().files.find((x) => x.rel === rel)
      if (!now) return
      if (now.dirty) {
        // 有未保存修改：只探测冲突（磁盘 mtime 变了 → 冲突横幅），内容以草稿为准
        if (getMtime(root, rel) !== undefined && getMtime(root, rel) !== res.mtimeMs) {
          setModel(m => onExternalChange(m, rel))
        }
        return
      }
      if (!canApplyCleanReload(model(), rel)) return
      setMtime(root, rel, res.mtimeMs)
      setEol(root, rel, res.eol)
      setFileVersion(prev => ({ ...prev, [rel]: res.mtimeMs }))
      clearDraft(root, rel)
      setModel(m => applyCleanReload(m, rel, res.content))
    } catch { /* 读失败：保留现状，等 watch / 下次激活 */ }
  }

  // ── 挂载编排（事件驱动；不用 effect：避免 markDirty 每个键重挂载）────
  // 默认先按磁盘刷新活动文件（切 tab / 关 tab 后接棒 / 从 diff 返回）；
  // 刚读盘打开的路径传 fresh:true 跳过重复读。
  async function mountActive(opts?: { fresh?: boolean }) {
    const rootAtStart = props.contentRoot
    const current = activeFile()
    if (current && !opts?.fresh) {
      await refreshActiveFromDisk(current.rel)
      // await 期间切了文件/会话：放弃本次挂载（目标路径自己会挂）
      if (rootAtStart !== props.contentRoot || model().active !== current.rel) return
    }
    const f = activeFile()
    const el = host
    if (!el) return
    await mountFor(f, el)
  }

  // agent 改动行装饰跟随：切文件/切模式/预览态/新 diff 都同步；编辑器重挂时在 mountFor 里补。
  createEffect(() => {
    const ranges = inlineRanges()
    const ed = editor
    if (!ed) return
    if (previewing()) { ed.setInlineDiff([]); return }
    ed.setInlineDiff(ranges)
    if (inlineIndex() >= ranges.length) setInlineIndex(0)
  })

  async function mountFor(f: OpenFile | null, el: HTMLElement) {
    const token = ++mountToken
    editor?.destroy()
    editor = null
    mountedRoot = null
    mountedRel = null
    await unwatchAll() // 先退订（含 f=null 的情形，防旧 watch 泄漏）
    if (!f) return
    const root = props.contentRoot
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
          if (root !== props.contentRoot || mountedRoot !== root || mountedRel !== f.rel) return
          setModel(m => m.files.find(file => file.rel === f.rel)?.preview ? promotePreview(m, f.rel) : m)
          setDraft(root, f.rel, h.getDoc())
          setModel(m => markDirty(m, f.rel))
        },
        onSave: () => void saveActive(),
        onSelectionChange: (s) => {
          if (root !== props.contentRoot || mountedRoot !== root || mountedRel !== f.rel) {
            clearSelection()
            return
          }
          if (!s) { clearSelection(); return }
          setSel({ rel: f.rel, ...s })
        },
      })
      if (token !== mountToken) { h.destroy(); return }
      editor = h
      mountedRoot = root
      mountedRel = f.rel
      const scopeState = contentScopeStateFor(props.scopeKey ?? null)
      const savedSelection = selectionFor(scopeState, f.rel)
      if (savedSelection) h.setSelection(savedSelection.anchor, savedSelection.head)
      h.setScroll(readingPositionFor(scopeState, f.rel) ?? 0)
      h.setInlineDiff(!previewing() ? inlineRanges() : [])
      h.setAnnotationHighlights(lineHighlightsFor(fileAnnotations()))
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
      if (root !== props.contentRoot) return
      const f = model().files.find(x => x.rel === rel)
      if (!f) return
      // 版本号对所有 kind 生效（图片/SVG 预览的缓存破坏；文本也会顺带更新预览图）
      setFileVersion(prev => ({ ...prev, [rel]: Date.now() }))
      if (isReadOnlyPreview(f.kind)) {
        // 图片/Office 只读：版本号触发重解析；stat 同步 mtime（切 tab 的激活比对用）
        void window.api.fs.statFile(root, rel).then((st) => {
          if (root !== props.contentRoot || !st.ok) return
          setMtime(root, rel, st.mtimeMs)
          if (f.kind === "image") {
            setImageMeta(prev => ({ ...prev, [rel]: { ...prev[rel], size: st.size } }))
          }
        })
        return
      }
      if (f.readOnly) return
      setModel(m => onExternalChange(m, rel))
      if (!f.dirty) void reloadClean(rel)
    })
    onCleanup(() => {
      off()
      rememberActiveScroll()
      void unwatchAll()
      editor?.destroy()
      editor = null
      mountedRoot = null
      mountedRel = null
      previewRestoredKey = null
    })
  })

  async function reloadClean(rel: string) {
    const root = props.contentRoot
    if (!root) return
    try {
      const res = await window.api.fs.readFile(root, rel)
      if (root !== props.contentRoot || !res.ok) return
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
    const root = props.contentRoot
    if (!f || !root || f.readOnly || saving()) return
    const content = editorSaveContent({
      draft: getDraft(root, f.rel),
      editorDoc: editor?.getDoc(),
      savedContent: f.savedContent,
      mountedRoot,
      mountedRel,
      root,
      rel: f.rel,
    })
    setSaving(true)
    try {
      const res = await window.api.fs.writeFile(root, f.rel, content, {
        ...(force ? {} : { ifMtimeMs: getMtime(root, f.rel) }),
        eol: getEol(root, f.rel) ?? "\n",
      })
      if (root !== props.contentRoot) return
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
    const root = props.contentRoot
    if (!root) return
    const res = await window.api.fs.readFile(root, rel)
    if (root !== props.contentRoot) return
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
    const root = props.contentRoot
    allowEmptyPersist = true
    rememberActiveScroll()
    if (root) clearDraft(root, rel)
    setModel(m => closeFile(m, rel))
    setSourceMode(prev => { const next = { ...prev }; delete next[rel]; return next })
    setImageMeta(prev => { const next = { ...prev }; delete next[rel]; return next })
    setFileVersion(prev => { const next = { ...prev }; delete next[rel]; return next })
    clearSelection()
    void mountActive()
  }

  function closeOthers(rel: string) {
    const others = model().files.filter(f => f.rel !== rel)
    if (others.some(f => f.dirty)) {
      showToastV2({ description: "其他标签有未保存修改，先保存后再关闭", duration: 3000 })
      return
    }
    for (const f of others) closeRel(f.rel)
  }

  function closeRight(rel: string) {
    const files = model().files
    const index = files.findIndex(f => f.rel === rel)
    if (index < 0) return
    const right = files.slice(index + 1)
    if (right.some(f => f.dirty)) {
      showToastV2({ description: "右侧标签有未保存修改，先保存后再关闭", duration: 3000 })
      return
    }
    for (const f of right) closeRel(f.rel)
  }

  const requestTabMenu = (rel: string, index: number, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    const root = props.contentRoot
    if (!root) return
    const abs = `${root.replace(/[\\/]+$/, "")}/${rel.replace(/^[\\/]+/, "")}`
    menuController.request(
      buildEditorTabMenu,
      { rel, index, count: model().files.length },
      (id) => {
        if (id === "editorTab.close") closeRel(rel)
        else if (id === "editorTab.closeOthers") closeOthers(rel)
        else if (id === "editorTab.closeRight") closeRight(rel)
        else if (id === "editorTab.copyPath") void navigator.clipboard.writeText(abs)
        else if (id === "editorTab.reveal") void window.api.revealPath(abs)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  async function openExternal(rel: string) {
    const root = props.contentRoot
    if (!root) return
    const res = await window.api.fs.openExternal(root, rel)
    if (!res.ok) setIoError("无法在外部编辑器打开")
  }

  /** 选区 toolbar 定位（相对 editor-body）。 */
  function showSelectionBar(kind: "source" | "quote", box: { left: number; top: number; width: number; height: number }) {
    if (selectionConsumed()) return
    const body = bodyEl
    if (!body) return
    const pos = placeSelectionToolbar(box, { w: 270, h: 30 }, { w: body.clientWidth, h: body.clientHeight })
    setSelectionBar({ kind, ...pos })
  }

  function showSourceBar(s: SelectionState) {
    showSelectionBar("source", { left: s.left, top: Math.max(0, s.top - 18), width: 8, height: 18 })
  }

  /** 预览面划选（md/docx）：选区落在 [data-annotatable="quote"] 内 → quote 锚 + 浮钮。 */
  function captureQuoteFromSelection(): boolean {
    if (quoteOpen() || annotOpen() || anchorOpen()) return false
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setQuoteSel(null)
      return false
    }
    const range = selection.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
    const container = el?.closest?.('[data-annotatable="quote"]') as HTMLElement | null
    if (!container || !container.contains(node)) return false
    const anchor = buildQuoteAnchor(selection.toString())
    if (!anchor) return false
    const rect = range.getBoundingClientRect()
    const host = bodyEl?.getBoundingClientRect()
    if (!host) return false
    const rects = Array.from(range.getClientRects()).map((r) => ({
      x: r.left - host.left,
      y: r.top - host.top,
      w: r.width,
      h: r.height,
    }))
    const minX = Math.min(...rects.map((r) => r.x))
    const minY = Math.min(...rects.map((r) => r.y))
    const maxX = Math.max(...rects.map((r) => r.x + r.w))
    const maxY = Math.max(...rects.map((r) => r.y + r.h))
    const box = { left: minX, top: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
    setQuoteSel({
      anchor,
      left: Math.max(8, rect.left - host.left),
      top: Math.max(8, rect.bottom - host.top + 4),
      rects,
      box,
      range: range.cloneRange(),
    })
    // ADE 模式：选中只出现「引用 / 批注」，不自动打开 composer。
    showSelectionBar("quote", box)
    return true
  }

  function handlePreviewSelection(_e: MouseEvent) {
    setSelectionConsumed(false)
    const gotQuote = captureQuoteFromSelection()
    if (gotQuote) return
    if (!previewing() && sel() && !annotOpen() && !quoteOpen() && !anchorOpen()) {
      showSourceBar(sel()!)
      return
    }
    if (!sel()) setSelectionBar(null)
  }

  // 源码编辑器选区（键盘/鼠标）→ toolbar；不自动打开 composer。
  createEffect(() => {
    const s = sel()
    if (!s || previewing() || annotOpen() || inlineEditOpen() || quoteOpen() || anchorOpen()) return
    showSourceBar(s)
  })

  // I1：预览面焦点不在 editor-body 内 —— 键盘路径挂 document；选区变化（含 Shift+方向键）也走同一捕获。
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        sel() &&
        !previewing() &&
        !annotOpen() &&
        !quoteOpen() &&
        !anchorOpen() &&
        !inlineEditOpen() &&
        bodyEl?.contains(document.activeElement)
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
        openInlineEditFromBar()
        return
      }
      if (!isAnnotationHotkey(e, IS_MAC)) return
      if (quoteSel()) {
        e.preventDefault()
        e.stopPropagation()
        setSelectionBar(null)
        setQuoteOpen(true)
        return
      }
      if (!previewing() && sel()) {
        e.preventDefault()
        e.stopPropagation()
        setSelectionBar(null)
        setAnnotOpen(true)
        return
      }
      if (captureQuoteFromSelection()) {
        e.preventDefault()
        e.stopPropagation()
        setSelectionBar(null)
        setQuoteOpen(true)
      }
    }
    let timer: number | undefined
    const onSelectionChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => captureQuoteFromSelection(), 150)
    }
    document.addEventListener("keydown", onKey, true)
    const onKeyUp = (e: KeyboardEvent) => {
      if (!(e.key === "Shift" || e.key.startsWith("Arrow"))) return
      if (annotOpen() || quoteOpen() || anchorOpen()) return
      setSelectionConsumed(false)
      if (!captureQuoteFromSelection() && !previewing() && sel()) showSourceBar(sel()!)
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target?.closest(".mafw-editor-body")) return
      if (target.closest(".mafw-annot-toolbar, .mafw-annot-sheet, .mafw-annot-rail")) return
      setSelectionConsumed(false)
    }
    document.addEventListener("keyup", onKeyUp)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("selectionchange", onSelectionChange)
    onCleanup(() => {
      document.removeEventListener("keydown", onKey, true)
      document.removeEventListener("keyup", onKeyUp)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("selectionchange", onSelectionChange)
      window.clearTimeout(timer)
    })
  })

  /** 表格单元格批注（csv/tsv）：事件委托，data-cell-ref 定位。 */
  function handleCellClick(e: MouseEvent) {
    // I6：拖选用户在复制单元格文字 —— 有非折叠 DOM 选区时不当批注点击。
    const domSel = window.getSelection()
    if (domSel && !domSel.isCollapsed && domSel.toString().trim()) return
    const el = (e.target as HTMLElement)?.closest?.("[data-cell-ref]") as HTMLElement | null
    if (!el || !el.dataset.cellRef) return
    const host = bodyEl?.getBoundingClientRect()
    if (!host) return
    const rect = el.getBoundingClientRect()
    setAnchorSel({
      anchor: { kind: "cell", ref: el.dataset.cellRef, value: el.textContent ?? "" },
      left: Math.max(8, rect.left - host.left),
      top: Math.max(8, rect.bottom - host.top + 4),
      box: { left: rect.left - host.left, top: rect.top - host.top, width: rect.width, height: rect.height },
    })
    setAnchorOpen(true)
  }

  /** 图片拖框：pointerdown/move/up（相对 region layer）。 */
  function onRegionDown(e: PointerEvent) {
    if (e.button !== 0) return
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
    const rel = activeFile()?.rel
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
    // M8：await 期间可能切了文件 —— 旧图坐标/截图绝不能挂到新文件上。
    if (!rel || activeFile()?.rel !== rel) {
      setDrag(null)
      return
    }
    const host = bodyEl?.getBoundingClientRect()
    setDrag(null)
    if (!host) return
    setAnchorSel({
      anchor: { kind: "region", ...norm },
      left: Math.max(8, Math.min(rect.left - host.left + px.left + px.w + 6, 420)),
      top: Math.max(8, rect.top - host.top + px.top + px.h + 6),
      box: { left: rect.left - host.left + px.left, top: rect.top - host.top + px.top, width: px.w, height: px.h },
      imageDataUrl,
    })
    setAnchorOpen(true)
  }

  /** M8：pointercancel（系统手势/失焦）时清掉拖框状态。 */
  function onRegionCancel() {
    dragStart = null
    setDrag(null)
  }

  const selRange = () => {
    const s = sel()
    if (!s) return null
    return lineRangeOf(editor?.getDoc() ?? "", s.from, s.to)
  }

  /** 统一批注出口：anchor=undefined 走 CodeMirror 行号锚；有 anchor 走预览锚点。 */
  /** 批注浮层打开时把锚点滚进视野（rev3：浮层在锚点旁，锚点必须在可视区）。 */
  function revealAnchor(box: { left: number; top: number; width: number; height: number }) {
    const body = bodyEl
    if (!body) return
    const container = body.querySelector(
      ".mafw-md-preview, .mafw-json-preview-wrap, .mafw-table-preview, .mafw-office-host",
    ) as HTMLElement | null
    if (!container) return
    if (box.top < container.scrollTop) container.scrollTop = Math.max(0, box.top - 24)
    else if (box.top + box.height > container.scrollTop + container.clientHeight) {
      container.scrollTop = box.top + box.height - container.clientHeight + 24
    }
  }

  createEffect(() => {
    const open = annotOpen() || quoteOpen() || anchorOpen()
    if (!open) return
    const box = annotOpen()
      ? (sel() ? { left: sel()!.left, top: sel()!.top, width: 8, height: 18 } : null)
      : quoteOpen()
        ? quoteSel()?.box
        : anchorSel()?.box
    if (!box) return
    requestAnimationFrame(() => revealAnchor(box))
  })

  /** 点击批注框以外的任意位置 → 关闭（Esc/取消之外的第三条退出路径）。 */
  function closeAnnotationUi() {
    setAnnotOpen(false)
    setInlineEditOpen(false)
    setQuoteOpen(false)
    setAnchorOpen(false)
    setQuoteSel(null)
    setAnchorSel(null)
  }

  createEffect(() => {
    const open = annotOpen() || inlineEditOpen() || quoteOpen() || anchorOpen()
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      const sheet = bodyEl?.querySelector(".mafw-annot-sheet")
      if (sheet && sheet.contains(target)) return
      closeAnnotationUi()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))
  })

  function submitAnnotationAnchored(
    anchor: AnnotationAnchor | undefined,
    comment: string,
    extra?: { imageDataUrl?: string; visual?: MarkVisual; range?: Range },
  ) {
    const f = activeFile()
    if (!f || !comment.trim() || !props.onAddAnnotation) return
    const source = annotationSourceFromScopeKey(props.scopeKey, props.contentRoot) ?? undefined
    const contentVersion = !f.dirty && f.savedContent.length > 0 ? textFingerprint(f.savedContent) : null
    if (anchor) {
      const saved = props.onAddAnnotation({
        rel: f.rel,
        startLine: 1,
        endLine: 1,
        code: "",
        comment: comment.trim(),
        anchor,
        imageDataUrl: extra?.imageDataUrl,
        scopeKey: props.scopeKey ?? undefined,
        root: props.contentRoot ?? undefined,
        source,
        contentVersion,
        capturedDirty: f.dirty,
      })
      if (saved && markOwner()) addMark(markOwner(), f.rel, anchor, extra?.visual, saved.id)
      if (saved && anchor.kind === "quote" && extra?.range) {
        setQuoteHighlight(saved.id, extra.range, "pending")
      }
      setSelectionConsumed(true)
      setAnnotOpen(false)
      setQuoteOpen(false)
      setAnchorOpen(false)
      setQuoteSel(null)
      setAnchorSel(null)
      setSelectionBar(null)
      return
    }
    const s = sel()
    const range = selRange()
    if (!s || !range) return
    if (!annotationApplies(f.rel, s.rel)) { clearSelection(); return }
    const saved = props.onAddAnnotation({
      rel: f.rel,
      startLine: range.startLine,
      endLine: range.endLine,
      code: s.text,
      comment: comment.trim(),
      scopeKey: props.scopeKey ?? undefined,
      root: props.contentRoot ?? undefined,
      source,
      contentVersion,
      capturedDirty: f.dirty,
    })
    if (saved && markOwner()) {
      addMark(markOwner(), f.rel, undefined, { point: { x: s.left, y: s.top } }, saved.id)
    }
    setSelectionConsumed(true)
    clearSelection()
  }

  /** pending 批注被删除/发送后，移除对应高亮（ADE：发送后高亮消失）。 */
  createEffect(() => {
    const owner = markOwner()
    if (!owner) return
    const ids = new Set(
      draftsFor(annotationOwner())
        .filter((a) => !a.discussedAt && !a.delegatedAt && annotationInScope(a, props.scopeKey, props.contentRoot))
        .map((a) => a.id),
    )
    for (const mark of marksForSession(owner)) {
      if (mark.annotationID && !ids.has(mark.annotationID)) {
        removeMarkByAnnotation(owner, mark.annotationID)
        removeQuoteHighlight(mark.annotationID)
      }
    }
  })

  /** quote 批注三态（pending / held / active）同步到 CSS Highlight。 */
  createEffect(() => {
    const active = activeAnnotationID()
    for (const a of fileAnnotations()) {
      if (a.anchor?.kind !== "quote") continue
      updateQuoteHighlightState(a.id, quoteHighlightState(active === a.id, !!a.held))
    }
  })

  /** 刷新/切回文件后按引文找回 Range，让高亮跟内容一起恢复。 */
  createEffect(() => {
    if (!previewing()) return
    const rel = activeFile()?.rel
    const text = activeSourceText()
    const items = fileAnnotations()
    if (!rel || !text || items.length === 0) return
    const timer = window.setTimeout(() => {
      const root = bodyEl?.querySelector(".mafw-md-preview, .mafw-office-host, .mafw-json-preview-wrap")
      if (!root) return
      for (const a of items) {
        if (a.anchor?.kind !== "quote" || !a.anchor.quote) continue
        const existing = quoteHighlightRange(a.id)
        if (existing?.startContainer.isConnected) continue
        if (existing) removeQuoteHighlight(a.id)
        const range = findQuoteRange(root, a.anchor.quote)
        if (range) setQuoteHighlight(a.id, range, quoteHighlightState(activeAnnotationID() === a.id, !!a.held))
      }
    }, 60)
    onCleanup(() => window.clearTimeout(timer))
  })

  onCleanup(() => clearQuoteHighlights())

  /** 源码面行高亮：pending 实线 / held 虚线（预览面用 DOM rect，不走这里）。 */
  createEffect(() => {
    const ranges = lineHighlightsFor(fileAnnotations())
    editor?.setAnnotationHighlights(ranges)
  })

  const quoteOfAnchor = (a: AnnotationAnchor) => {
    if (a.kind === "quote") return a.quote
    if (a.kind === "jsonPath") return a.path
    if (a.kind === "cell") return `${a.ref} · ${a.value}`
    return `区域 ${Math.round(a.x * 100)}%,${Math.round(a.y * 100)}%`
  }

  /** toolbar「引用」：把选区作为引文放进聊天输入框（不发送）。 */
  function quoteCurrentSelection() {
    const sid = props.sessionID
    if (!sid) return
    let quote = ""
    if (selectionBar()?.kind === "quote" && quoteSel()) {
      const a = quoteSel()!.anchor
      if (a.kind !== "quote") return
      quote = buildFileQuote(activeFile()?.rel ?? "", a.quote)
    } else {
      const s = sel()
      if (!s) return
      const range = selRange()
      quote = buildFileQuote(s.rel, s.text, range ? { startLine: range.startLine, endLine: range.endLine } : undefined)
    }
    if (!quote) return
    pushComposerInsert(sid, quote)
    showToastV2({ description: "已引用到输入框", duration: 2000 })
    setSelectionBar(null)
  }

  /** toolbar「批注」：按选区来源打开对应 composer。 */
  function openAnnotationFromBar() {
    const bar = selectionBar()
    if (!bar) return
    setSelectionConsumed(true)
    setSelectionBar(null)
    if (bar.kind === "quote") setQuoteOpen(true)
    else setAnnotOpen(true)
  }

  function openInlineEditFromBar() {
    if (!sel() || previewing()) return
    setSelectionConsumed(true)
    setSelectionBar(null)
    setInlineEditOpen(true)
  }

  function submitInlineEdit(instruction: string) {
    const f = activeFile()
    const s = sel()
    const range = selRange()
    if (!f || !s || !range) return
    props.onInlineEdit?.({
      rel: f.rel,
      startLine: range.startLine,
      endLine: range.endLine,
      code: s.text,
      instruction,
      root: props.contentRoot ?? undefined,
      scopeKey: props.scopeKey ?? undefined,
    })
    setInlineEditOpen(false)
    setSelectionConsumed(true)
    clearSelection()
  }

  // 点击 toolbar / margin card / composer 以外的位置 → 收起浮层。
  createEffect(() => {
    if (!selectionBar()) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (target?.closest(".mafw-annot-toolbar, .mafw-annot-sheet, .mafw-annot-rail")) return
      setSelectionBar(null)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))
  })

  const toolbarSlots = (): DocumentToolbarSlots => ({
    ariaLabel: "编辑器工具栏",
    leading: () => (
      <>
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
      </>
    ),
    trailing: () => (
      <>
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
        <Show when={inlineRanges().length > 0}>
          <div class="mafw-editor-inline-diff">
            <span class="mafw-editor-inline-diff-count" aria-label={`${inlineRanges().length} 处 agent 改动`}>{inlineRanges().length}</span>
            <TooltipV2 value="上一处改动" openDelay={300}>
              <ButtonV2 variant="ghost" size="small" aria-label="上一处改动" onClick={() => gotoInlineChange(-1)}>
                <Icon name="arrow-up" size="small" />
              </ButtonV2>
            </TooltipV2>
            <TooltipV2 value="下一处改动" openDelay={300}>
              <ButtonV2 variant="ghost" size="small" aria-label="下一处改动" onClick={() => gotoInlineChange(1)}>
                <Icon name="chevron-down" size="small" />
              </ButtonV2>
            </TooltipV2>
          </div>
        </Show>
      </>
    ),
  })

  onMount(() => {
    const unregister = registerDocumentToolbar("file", toolbarSlots)
    onCleanup(unregister)
  })

  const body = (
    <div class="mafw-editor-dock">
      <Show when={ioError()}>
        <DockBanner kind="error" text={ioError()!} action={{ label: "关闭", onClick: () => setIoError(null) }} />
      </Show>

      <Show
        when={model().files.length > 0}
        fallback={<DockEmpty icon="file-tree" text="从左侧文件树或取景器（Ctrl+P）选择文件" hint="单击文件即可在此编辑" />}
      >
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
        >
          <div
            class="mafw-editor-host"
            ref={(el) => { host = el }}
            style={{ display: previewing() ? "none" : "block" }}
          />

          {/* 文件预览（图片只读 / SVG 预览态）：host 保持挂载，仅隐藏 */}
          <Show when={previewing() && activeFile() && activeFile()!.kind !== "table" && activeFile()!.kind !== "markdown" && activeFile()!.kind !== "json" && !officeKind()}>
            <div class="mafw-file-preview">
              <div class="mafw-file-preview-canvas">
                <img
                  class="mafw-file-preview-img"
                  crossOrigin="anonymous"
                  src={activePreviewUrl()}
                  alt={activeFile()!.rel}
                  onLoad={(e) => recordImageDims(activeFile()!.rel, e.currentTarget)}
                />
                <div
                  class="mafw-region-layer"
                  aria-label="拖框批注区域"
                  onPointerDown={onRegionDown}
                  onPointerMove={onRegionMove}
                  onPointerUp={onRegionUp}
                  onPointerCancel={onRegionCancel}
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
                    box: { left: rect.left - host.left, top: rect.top - host.top, width: rect.width, height: rect.height },
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
              url={activePreviewUrl()}
              rel={activeFile()!.rel}
              onOpenExternal={() => { const f = activeFile(); if (f) void openExternal(f.rel) }}
              onAnnotateCell={(a, rect) => {
                const host = bodyEl?.getBoundingClientRect()
                if (!host) return
                setAnchorSel({
                  anchor: { kind: "cell", ...a },
                  left: Math.max(8, rect.left - host.left),
                  top: Math.max(8, rect.top + rect.height - host.top + 4),
                  box: { left: rect.left - host.left, top: rect.top - host.top, width: rect.width, height: rect.height },
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
                  box: { left: point.clientX - host.left, top: point.clientY - host.top, width: 1, height: 1 },
                })
                setAnchorOpen(true)
              }}
              pins={fileMarks()
                .filter((m) => m.anchor?.kind === "region" && !!m.anchor.slide)
                .map((m) => {
                  const a = m.anchor as Extract<AnnotationAnchor, { kind: "region" }>
                  return { x: a.x, y: a.y, slide: a.slide, status: m.status }
                })}
              onOpenReview={props.onOpenReview}
            />
          </Show>

          {/* 批注高亮层（ADE 三态）：pending 实线 / held 虚线 / active 加亮；不做无限 pulse */}
          <div class="mafw-annot-layer" aria-hidden="true">
            <For each={fileMarks()}>
              {(m) => (
                <div class="mafw-annot-mark-group" data-active={activeAnnotationID() === m.annotationID || undefined}>
                  <For each={m.anchor?.kind === "quote" && supportsQuoteHighlights() ? [] : (m.visual?.rects ?? [])}>
                    {(r) => (
                      <div
                        class="mafw-annot-rect"
                        data-status={markStatus(m)}
                        style={{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}
                      />
                    )}
                  </For>
                  <Show when={m.visual?.point}>
                    <div
                      class="mafw-annot-dot"
                      data-status={markStatus(m)}
                      style={{ left: `${m.visual!.point!.x}px`, top: `${m.visual!.point!.y}px` }}
                    />
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* margin rail：当前文件的待发送批注（ADE：评论卡跟在高亮旁边） */}
          <Show when={fileAnnotations().length > 0}>
            <aside class="mafw-annot-rail" aria-label="当前文件批注">
              <div class="mafw-annot-rail-head">
                <span>批注</span>
                <span class="mafw-annot-rail-count">{fileAnnotations().length}</span>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-annot-rail-action"
                  disabled={fileAnnotations().filter((annotation) => !annotation.held).length === 0}
                  onClick={() => props.onDiscussAnnotations?.(
                    fileAnnotations().filter((annotation) => !annotation.held),
                  )}
                >
                  讨论 / 处理
                </ButtonV2>
              </div>
              <For each={fileAnnotations()}>
                {(a) => (
                  <div
                    class="mafw-annot-card"
                    classList={{ "is-held": !!a.held, "is-active": activeAnnotationID() === a.id }}
                  >
                    <ButtonV2
                      variant="ghost"
                      size="small"
                      class="mafw-annot-card-main"
                      onClick={() => focusAnnotation(a)}
                    >
                      <span class="mafw-annot-card-quote">{quoteOfAnnotation(a)}</span>
                      <span class="mafw-annot-card-note">{a.comment}</span>
                      <span class="mafw-annot-card-where">{locationOfAnnotation(a)}</span>
                    </ButtonV2>
                    <div class="mafw-annot-card-foot">
                      <CheckboxV2
                        class="mafw-annot-card-check"
                        label="随下一条发送"
                        checked={!a.held}
                        onChange={(checked) => setAnnotationHeld(a.sessionID, a.id, !checked)}
                      />
                      <ButtonV2
                        variant="ghost"
                        size="small"
                        class="mafw-annot-card-x"
                        aria-label="删除批注"
                        onClick={() => dropAnnotation(a)}
                      >
                        <Icon name="close" size="small" />
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </For>
            </aside>
          </Show>

          {/* 选区 toolbar（ADE 模式）：选中只出现「引用 / 批注」 */}
          <Show when={selectionBar()}>
            <div
              class="mafw-annot-toolbar"
              style={{ left: `${selectionBar()!.left}px`, top: `${selectionBar()!.top}px` }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Show when={selectionBar()!.kind === "source"}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-annot-toolbar-btn is-primary"
                  onClick={openInlineEditFromBar}
                >
                  <Icon name="pencil-line" size="small" />
                  AI 编辑
                </ButtonV2>
                <span class="mafw-annot-toolbar-sep" aria-hidden="true" />
              </Show>
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-annot-toolbar-btn"
                onClick={quoteCurrentSelection}
              >
                <Icon name="speech-bubble" size="small" />
                引用
              </ButtonV2>
              <span class="mafw-annot-toolbar-sep" aria-hidden="true" />
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-annot-toolbar-btn"
                onClick={openAnnotationFromBar}
              >
                <Icon name="comment" size="small" />
                批注
              </ButtonV2>
            </div>
          </Show>

          {/* 批注 composer（ADE：300px 小纸条；保存后进入 pending） */}
          <Show when={annotOpen() && sel()}>
            <AnnotationSheet
              anchor={{ left: Math.max(8, sel()!.left), top: sel()!.top, width: 8, height: 18 }}
              quote={sel()!.text}
              meta={`${sel()!.rel} · L${selRange()?.startLine}${selRange()?.endLine !== selRange()?.startLine ? `–${selRange()?.endLine}` : ""}`}
              onSubmit={(comment) => submitAnnotationAnchored(undefined, comment)}
              onCancel={() => { setSelectionConsumed(true); setAnnotOpen(false); setSelectionBar(null) }}
            />
          </Show>
          <Show when={inlineEditOpen() && sel()}>
            <InlineEditSheet
              anchor={{ left: Math.max(8, sel()!.left), top: sel()!.top, width: 8, height: 18 }}
              quote={sel()!.text}
              meta={`${sel()!.rel} · L${selRange()?.startLine}${selRange()?.endLine !== selRange()?.startLine ? `–${selRange()?.endLine}` : ""}`}
              onSubmit={submitInlineEdit}
              onCancel={() => { setSelectionConsumed(true); setInlineEditOpen(false); setSelectionBar(null) }}
            />
          </Show>
          <Show when={quoteOpen() && quoteSel()}>
            <AnnotationSheet
              anchor={quoteSel()!.box}
              quote={quoteOfAnchor(quoteSel()!.anchor)}
              meta={`${activeFile()?.rel ?? ""} · ${describeAnchor(quoteSel()!.anchor)}`}
              placeholder="这条批注会随下一条消息发给 Agent"
              onSubmit={(comment) => {
                submitAnnotationAnchored(quoteSel()?.anchor, comment, {
                  visual: { rects: quoteSel()?.rects },
                  range: quoteSel()?.range,
                })
                setQuoteOpen(false)
                setQuoteSel(null)
              }}
              onCancel={() => { setSelectionConsumed(true); setQuoteOpen(false); setQuoteSel(null); setSelectionBar(null) }}
            />
          </Show>
          <Show when={anchorOpen() ? anchorSel() : null} keyed>
            {(sel) => (
              <AnnotationSheet
                anchor={sel.box}
                quote={quoteOfAnchor(sel.anchor)}
                meta={`${activeFile()?.rel ?? ""} · ${describeAnchor(sel.anchor)}`}
                placeholder="这条批注会随下一条消息发给 Agent"
                onSubmit={(comment) => {
                  submitAnnotationAnchored(sel.anchor, comment, {
                    imageDataUrl: sel.imageDataUrl,
                    visual: sel.imageDataUrl ? undefined : { point: { x: sel.left, y: sel.top } },
                  })
                  setAnchorOpen(false)
                  setAnchorSel(null)
                }}
                onCancel={() => { setSelectionConsumed(true); setAnchorOpen(false); setAnchorSel(null) }}
              />
            )}
          </Show>
        </div>
      </Show>
    </div>
  )

  if (props.embedded) return body

  const slots = toolbarSlots()
  return (
    <DocumentFrame
      tabs={tabs().length > 0 ? (
        <DocumentTabs
          items={tabs()}
          ariaLabel="打开的文档"
          onSelect={activateRel}
          onClose={closeRel}
          onContextMenu={(id, event) => requestTabMenu(id, model().files.findIndex(f => f.rel === id), event)}
        />
      ) : undefined}
      toolbar={
        <DocumentToolbar
          ariaLabel={slots.ariaLabel}
          leading={slots.leading?.()}
          trailing={slots.trailing?.()}
        />
      }
    >
      {body}
    </DocumentFrame>
  )
}
