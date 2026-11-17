// 改动集 tab：一个 turn / 一个 Goal revision 一个 tab。
// 文件导航只在顶上 toolbar 的下拉里，不再常驻左侧文件列表。
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { DiffReviewPanel, type FileDiffEntry } from "./DiffReviewPanel"
import { changeStatusLetter } from "./change-tree"
import { normalizeSessionDiffs } from "../ingest/diffs"
import { toFileDiffEntries, goalDiffErrorText } from "../changes/goal-changes"
import { podHttpStatus } from "../pod-model"
import { registerDocumentToolbar } from "../documents/document-toolbar-registry"
import {
  pickChangeSetFile,
  setActiveChangeSetFile,
  updateChangeSetDocument,
  type ChangeSetDocument,
} from "../documents/change-set-documents"

export type ChangeSetViewProps = {
  doc: ChangeSetDocument
  onOpenFile: (rel: string, line?: number) => void
  onSendComment?: (sessionID: string, text: string) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
    scopeKey?: string
    root?: string
    source?: import("../../../shared/annotation-types").AnnotationSource
  }) => void
}

export function ChangeSetView(props: ChangeSetViewProps): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let wrapEl: HTMLDivElement | undefined

  const files = () => props.doc.files
  const currentFile = createMemo(() =>
    files().find((file) => (file.file ?? "") === props.doc.activeFile) ?? files()[0] ?? null,
  )
  const currentRel = () => currentFile()?.file ?? ""

  const load = async () => {
    if (busy()) return
    setBusy(true)
    setError(null)
    const source = props.doc.source
    try {
      let next: FileDiffEntry[] = []
      if (source.kind === "goal") {
        const diff = await window.api.mafw.pod.worktreeDiff(source.podId, source.goalId, source.revision)
        next = toFileDiffEntries(Array.isArray(diff?.files) ? diff.files : [])
      } else if (source.turnID) {
        const diff = await window.api.mafw.sessions.diff(source.sessionID, source.turnID)
        next = normalizeSessionDiffs(diff)
      } else {
        const diff = await window.api.mafw.sessions.diff(source.sessionID)
        next = normalizeSessionDiffs(diff)
      }
      updateChangeSetDocument(props.doc.id, {
        files: next,
        activeFile: pickChangeSetFile(next, props.doc.activeFile),
      })
    } catch (err: any) {
      setError(
        props.doc.source.kind === "goal"
          ? goalDiffErrorText(podHttpStatus(err))
          : String(err?.message ?? err).slice(0, 160) || "改动集加载失败",
      )
    } finally {
      setBusy(false)
    }
  }

  // 新开的 Goal / turn tab 没有文件快照；首屏按来源拉一次。
  createEffect(on(() => props.doc.id, () => {
    if (props.doc.files.length > 0) return
    void load()
  }, { defer: false }))

  const choose = (rel: string) => {
    setActiveChangeSetFile(props.doc.id, rel)
    setOpen(false)
  }

  const moveCursor = (delta: number) => {
    const list = files()
    if (list.length === 0) return
    const index = list.findIndex((file) => (file.file ?? "") === currentRel())
    const base = index >= 0 ? index : 0
    setCursor(Math.max(0, Math.min(list.length - 1, base + delta)))
  }

  const openMenu = () => {
    const list = files()
    const index = list.findIndex((file) => (file.file ?? "") === currentRel())
    setCursor(index >= 0 ? index : 0)
    setOpen(true)
  }

  onMount(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!open()) return
      const target = event.target as Node | null
      if (target && wrapEl?.closest(".mafw-document-toolbar")?.contains(target)) return
      setOpen(false)    }
    document.addEventListener("mousedown", onPointerDown)
    onCleanup(() => document.removeEventListener("mousedown", onPointerDown))
  })

  onMount(() => {
    const unregister = registerDocumentToolbar("changeset", () => ({
      ariaLabel: "改动集工具栏",
      center: () => (
        <div class="mafw-changeset-picker" ref={(el) => { wrapEl = el }}>
          <span class="mafw-changeset-picker-label">改动集</span>
          <Show
            when={files().length > 0}
            fallback={<span class="mafw-changeset-picker-empty">{busy() ? "正在读取…" : "没有文件"}</span>}
          >
            <button
              type="button"
              class="mafw-changeset-trigger"
              aria-haspopup="listbox"
              aria-expanded={open()}
              onClick={() => (open() ? setOpen(false) : openMenu())}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false)
                  return
                }
                if (!open()) {
                  if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openMenu()
                  }
                  return
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  moveCursor(1)
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  moveCursor(-1)
                } else if (event.key === "Enter") {
                  event.preventDefault()
                  const target = files()[cursor()]
                  if (target?.file) choose(target.file)
                }
              }}
            >
              <span class="mafw-changeset-status" data-status={currentFile()?.status}>
                {changeStatusLetter(currentFile()?.status)}
              </span>
              <span class="mafw-changeset-path">{currentRel()}</span>
              <span class="mafw-changeset-caret" aria-hidden="true">▾</span>
            </button>
            <span class="mafw-changeset-count">{files().length} files</span>
          </Show>

          <Show when={open()}>
            <div class="mafw-changeset-menu" role="listbox" aria-label="改动集文件">
              <div class="mafw-changeset-menu-head">
                <span>改动集文件</span>
                <span>{files().length}</span>
              </div>
              <div class="mafw-changeset-menu-scroll">
                <For each={files()}>
                  {(file, index) => {
                    const rel = file.file ?? ""
                    const active = () => rel === currentRel()
                    return (
                      <div
                        class="mafw-changeset-option"
                        classList={{ "is-active": active(), "is-cursor": cursor() === index() }}
                        role="option"
                        aria-selected={active()}
                        title={rel}
                        onClick={() => choose(rel)}
                        onMouseEnter={() => setCursor(index())}
                      >
                        <span class="mafw-changeset-status" data-status={file.status}>
                          {changeStatusLetter(file.status)}
                        </span>
                        <span class="mafw-changeset-option-path">{rel}</span>
                        <span class="mafw-changeset-option-add">+{file.additions ?? 0}</span>
                        <span class="mafw-changeset-option-del">-{file.deletions ?? 0}</span>
                        <Show when={active()}>
                          <span class="mafw-changeset-option-check" aria-hidden="true">✓</span>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
              <div class="mafw-changeset-menu-foot">
                <span>↑↓ 切换 · Enter 打开</span>
                <span>Esc 关闭</span>
              </div>
            </div>
          </Show>
        </div>
      ),
      trailing: () => (
        <>
          <Show when={error()}>
            <span class="mafw-changeset-error" title={error()!}>{error()}</span>
          </Show>
          <Show when={props.doc.source.kind === "goal"}>
            <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={() => void load()}>
              {busy() ? "刷新中…" : "刷新"}
            </ButtonV2>
          </Show>
          <ButtonV2
            variant="ghost"
            size="small"
            disabled={!currentRel()}
            onClick={() => props.onOpenFile(currentRel(), props.doc.anchorLine)}
          >
            打开文件
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            disabled={!currentRel()}
            onClick={() => { if (currentRel()) void navigator.clipboard.writeText(currentRel()) }}
          >
            复制路径
          </ButtonV2>
        </>
      ),
    }))
    onCleanup(unregister)
  })

  return (
    <div class="mafw-changeset-document">
      <Show
        when={currentFile()}
        fallback={
          <div class="mafw-changeset-empty">
            <Show when={!busy()} fallback={<span>正在读取改动…</span>}>
              <span>{error() ?? "这个改动集还没有文件"}</span>
            </Show>
          </div>
        }
      >
        {(file) => (
          <Show
            when={props.doc.source.kind === "session"}
            fallback={
              <DiffReviewPanel
                chrome="tab"
                previewOnly={props.doc.source.kind !== "goal"}
                sessionID=""
                diffs={[file()]}
                initialFile={currentRel()}
                allowSessionFallback={false}
                allowNonInvertibleRevert={false}
                hint={null}
                focusLine={props.doc.anchorLine}
                onAddAnnotation={props.doc.source.kind === "goal" ? props.onAddAnnotation : undefined}
              />
            }
          >
            <DiffReviewPanel
              chrome="tab"
              sessionID={props.doc.source.kind === "session" ? props.doc.source.sessionID : ""}
              diffs={[file()]}
              initialFile={currentRel()}
              allowSessionFallback={false}
              allowNonInvertibleRevert={false}
              onSendComment={props.onSendComment}
              onAddAnnotation={props.onAddAnnotation}
              focusLine={props.doc.anchorLine}
            />
          </Show>
        )}
      </Show>
    </div>
  )
}
