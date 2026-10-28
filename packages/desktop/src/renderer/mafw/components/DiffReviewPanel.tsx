// DiffReviewPanel（切片 2）：会话改动逐 hunk 审阅。
// 数据源优先 props.diffs（SSE session.diff 实时快照），空则拉 GET /sessions/:id/diff。
// 勾选 hunk → POST /sessions/:id/diff/revert（gateway 反转 patch 后 vcs.apply）→ 刷新。
import { Show, For, createSignal, createMemo, createEffect } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { splitHunks, hunkStats, pickSelectedFile, buildDiffCommentPrompt, lineNewNumber, buildLineCommentPrompt, type DiffHunk } from "./diff-hunks"
import { isFileRevertible } from "./checkpoint-revert"
import { shouldFetchSessionDiff } from "./turn-diffs"
import type { FileDiffInfo } from "@mafw/sdk"

export interface FileDiffEntry {
  file?: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
}

export function DiffReviewPanel(props: {
  sessionID: string
  /** SSE session.diff 实时快照（可缺省 → 组件自行拉取） */
  diffs?: FileDiffEntry[]
  onClose?: () => void
  /** 行级评论回喂（可选）：组装好的评论 prompt 发到会话 */
  onSendComment?: (sessionID: string, text: string) => void
  /** 加入批注草稿（可选）：同一批注池，随下一条消息打包 */
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
  /** 嵌入 RightDock changes tab（隐藏自带文件列表栏与关闭钮，改显返回钮） */
  embedded?: boolean
  /** 初始选中的文件（从 dock 文件列表进入时预选） */
  initialFile?: string | null
  onBack?: () => void
  /** 嵌入 dock 时禁止回退到 session-wide VCS diff（默认允许，保留旧行为） */
  allowSessionFallback?: boolean
  /** 嵌入 dock 时只允许可反转的修改型 patch（默认允许，保留旧行为） */
  allowNonInvertibleRevert?: boolean
}) {
  const [fetched, setFetched] = createSignal<FileDiffEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  // 两栏：左文件列表 + 右当前文件 hunks（opencode v2 ReviewPanel 模式）
  const [selectedFileRaw, setSelectedFile] = createSignal<string | null>(props.initialFile ?? null)
  // 行级评论：commentingOn = 正在评论的 hunk key
  const [commentingOn, setCommentingOn] = createSignal<string | null>(null)
  // W0-3：行级评论——正在评论的具体行（hunk key + 行下标）
  const [commentingLine, setCommentingLine] = createSignal<{ key: string; idx: number } | null>(null)
  const [commentDraft, setCommentDraft] = createSignal("")

  const files = createMemo<FileDiffEntry[]>(() => {
    const live = props.diffs
    if (live && live.length > 0) return live
    return fetched()
  })

  const fileName = (f: FileDiffEntry) => f.file ?? "(unknown)"
  const fileNames = createMemo(() => files().map(fileName))
  const selectedFile = createMemo(() => pickSelectedFile(fileNames(), selectedFileRaw()))
  const currentFile = createMemo(() => files().find((f) => fileName(f) === selectedFile()))

  const refresh = () => {
    const hasDiffs = (props.diffs?.length ?? 0) > 0
    if (!shouldFetchSessionDiff(hasDiffs, props.allowSessionFallback !== false)) {
      setFetched([])
      setLoading(false)
      return
    }
    setLoading(true)
    window.api.mafw.sessions.diff(props.sessionID)
      .then((r) => setFetched((r as any)?.files ?? []))
      .catch(() => { /* fail-open：面板保持空态 */ })
      .finally(() => setLoading(false))
  }
  createEffect(() => { if (props.sessionID) refresh() })

  const keyed = (file: string, i: number) => `${file}#${i}`
  const toggle = (key: string) => {
    const next = new Set(selected())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const revertSelected = async () => {
    const patches: Array<{ file?: string; patch: string; hunkIndices: number[] }> = []
    for (const f of files()) {
      if (!f.patch) continue
      if (!isFileRevertible(f, props.allowNonInvertibleRevert !== false)) continue
      const { hunks } = splitHunks(f.patch)
      const idx: number[] = []
      hunks.forEach((_, i) => { if (selected().has(keyed(fileName(f), i))) idx.push(i) })
      if (idx.length > 0) patches.push({ file: f.file, patch: f.patch, hunkIndices: idx })
    }
    if (patches.length === 0) { showToastV2({ description: "未勾选任何 hunk", duration: 2000 }); return }
    setBusy(true)
    try {
      const r = await window.api.mafw.sessions.revertDiff(props.sessionID, patches)
      showToastV2({ description: `已回退 ${r.reverted} 个文件的选中改动`, duration: 2500 })
      setSelected(new Set<string>())
      refresh()
    } catch (e: any) {
      showToastV2({ description: `回退失败：${String(e?.message ?? e).slice(0, 80)}`, duration: 4000 })
    } finally {
      setBusy(false)
    }
  }

  const totalSel = () => selected().size

  // 行级评论回喂（opencode onLineComment 模式）：组装 prompt 交给宿主发送
  const submitComment = (file: string, h: DiffHunk) => {
    const text = commentDraft().trim()
    if (!text || !props.onSendComment) return
    props.onSendComment(props.sessionID, buildDiffCommentPrompt(file, h.header, h.lines, text))
    setCommentDraft("")
    setCommentingOn(null)
  }

  // 加入批注草稿：hunk 的 new 侧行号范围 + 新侧代码（上下文 + 新增行）
  const submitDraftComment = (file: string, h: DiffHunk) => {
    const text = commentDraft().trim()
    if (!text || !props.onAddAnnotation) return
    const code = h.lines
      .filter((l) => l.startsWith("+") || l.startsWith(" "))
      .map((l) => l.slice(1))
      .join("\n")
      .trim()
    const endLine = h.newStart + Math.max(0, h.newCount - 1)
    props.onAddAnnotation({ rel: file, startLine: h.newStart, endLine, code, comment: text })
    setCommentDraft("")
    setCommentingOn(null)
  }

  // W0-3：行级评论——点击某行（"+" / " "）在该行下方就地开评论框
  const openLineComment = (e: MouseEvent, key: string, idx: number) => {
    // 阻止 <label> 默认行为（点击行不应切换 hunk 勾选框）
    e.preventDefault()
    e.stopPropagation()
    const cur = commentingLine()
    if (cur && cur.key === key && cur.idx === idx) {
      setCommentingLine(null)
      setCommentDraft("")
      return
    }
    setCommentingOn(null)
    setCommentingLine({ key, idx })
    setCommentDraft("")
  }

  const submitLineComment = (file: string, h: DiffHunk, idx: number) => {
    const text = commentDraft().trim()
    const n = lineNewNumber(h, idx)
    if (!text || n === null || !props.onSendComment) return
    props.onSendComment(props.sessionID, buildLineCommentPrompt(file, n, h.lines[idx], text))
    setCommentDraft("")
    setCommentingLine(null)
  }

  const submitLineDraftComment = (file: string, h: DiffHunk, idx: number) => {
    const text = commentDraft().trim()
    const n = lineNewNumber(h, idx)
    if (!text || n === null || !props.onAddAnnotation) return
    const code = h.lines[idx].replace(/^[+\- ]/, "")
    props.onAddAnnotation({ rel: file, startLine: n, endLine: n, code, comment: text })
    setCommentDraft("")
    setCommentingLine(null)
  }

  return (
    <div class="mafw-diff-panel" classList={{ embedded: !!props.embedded }} role="dialog" aria-label="审阅改动">
      <header class="mafw-diff-panel-header">
        <Show when={props.embedded && props.onBack}>
          <ButtonV2 variant="ghost" size="small" class="mafw-diff-panel-back" onClick={() => props.onBack?.()}>← 改动列表</ButtonV2>
        </Show>
        <h2>审阅改动</h2>
        <div class="mafw-diff-panel-actions">
          <Show when={props.allowSessionFallback !== false}>
            <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={() => void refresh()}>刷新</ButtonV2>
          </Show>
          <Show when={!props.embedded}>
            <ButtonV2 variant="ghost" size="small" onClick={() => props.onClose?.()}>关闭</ButtonV2>
          </Show>
        </div>
      </header>
      <p class="mafw-diff-panel-hint">勾选要撤销的 hunk，点「回退选中」。未勾选的改动保持不变。</p>
      <div class="mafw-diff-panel-body">
        <Show when={!loading()} fallback={<p class="mafw-diff-panel-empty">加载中…</p>}>
          <Show
            when={files().length > 0}
            fallback={<p class="mafw-diff-panel-empty">当前会话没有待审的文件改动。</p>}
          >
            <Show when={!props.embedded}>
            <div class="mafw-diff-files">
              <For each={files()}>
                {(f) => (
                  <div
                    class="mafw-diff-file-row"
                    classList={{ sel: fileName(f) === selectedFile() }}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedFile(fileName(f))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedFile(fileName(f)) }}
                  >
                    <span class="mafw-diff-file-row-name">{fileName(f)}</span>
                    <Show when={typeof f.additions === "number"}>
                      <span class="mafw-diff-stat add">+{f.additions}</span>
                    </Show>
                    <Show when={typeof f.deletions === "number"}>
                      <span class="mafw-diff-stat del">-{f.deletions}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            </Show>
            <div class="mafw-diff-detail">
              <Show when={currentFile()}>
                {(f) => {
                  const file = fileName(f())
                  const { hunks } = splitHunks(f().patch ?? "")
                  const revertible = isFileRevertible(f(), props.allowNonInvertibleRevert !== false)
                  return (
                    <section class="mafw-diff-file">
                      <header class="mafw-diff-file-header">
                        <span class="mafw-diff-file-name">{file}</span>
                        <Show when={typeof f().additions === "number"}>
                          <span class="mafw-diff-stat add">+{f().additions}</span>
                        </Show>
                        <Show when={typeof f().deletions === "number"}>
                          <span class="mafw-diff-stat del">-{f().deletions}</span>
                        </Show>
                      </header>
                      <Show when={!revertible}>
                        <p class="mafw-diff-panel-hint">新增/删除文件不支持回退</p>
                      </Show>
                      <For each={hunks}>
                        {(h: DiffHunk, i) => {
                          const key = keyed(file, i())
                          const stats = hunkStats(h.lines)
                          const checked = () => selected().has(key)
                          return (
                            <label class="mafw-diff-hunk" classList={{ checked: checked() }}>
                              <input
                                type="checkbox"
                                checked={checked()}
                                disabled={!revertible}
                                onChange={() => { if (revertible) toggle(key) }}
                              />
                              <span class="mafw-diff-hunk-header">{h.header}</span>
                              <span class="mafw-diff-stat add">+{stats.added}</span>
                              <span class="mafw-diff-stat del">-{stats.removed}</span>
                              <Show when={props.onSendComment}>
                                <ButtonV2
                                  variant="ghost"
                                  size="small"
                                  class="mafw-diff-comment-btn"
                                  onClick={(e: MouseEvent) => { e.preventDefault(); setCommentingLine(null); setCommentingOn(commentingOn() === key ? null : key); setCommentDraft("") }}
                                >评论</ButtonV2>
                              </Show>
                              <pre class="mafw-diff-hunk-body">
                                <For each={h.lines}>
                                  {(line, li) => {
                                    const lineNo = () => lineNewNumber(h, li())
                                    const commentable = () => lineNo() !== null && (!!props.onSendComment || !!props.onAddAnnotation)
                                    return (
                                      <>
                                      <span
                                        classList={{
                                          "mafw-diff-line": true,
                                          add: line.startsWith("+"),
                                          del: line.startsWith("-"),
                                          commentable: commentable(),
                                        }}
                                        onClick={commentable() ? (e: MouseEvent) => openLineComment(e, key, li()) : undefined}
                                      >{line}</span>
                                      <Show when={commentingLine()?.key === key && commentingLine()?.idx === li()}>
                                        <div class="mafw-diff-comment mafw-diff-comment-line" onClick={(e) => e.preventDefault()}>
                                          <div class="mafw-diff-comment-line-meta">第 {lineNo()} 行</div>
                                          <textarea
                                            class="mafw-diff-comment-input"
                                            rows={3}
                                            placeholder="对这一行有什么意见？（回喂给 agent 修正）"
                                            value={commentDraft()}
                                            onInput={(e) => setCommentDraft(e.currentTarget.value)}
                                          />
                                          <div class="mafw-diff-comment-actions">
                                            <ButtonV2 variant="ghost" size="small" onClick={() => { setCommentingLine(null); setCommentDraft("") }}>取消</ButtonV2>
                                            <Show when={props.onAddAnnotation}>
                                              <ButtonV2
                                                variant="outline"
                                                size="small"
                                                disabled={!commentDraft().trim()}
                                                onClick={() => submitLineDraftComment(file, h, li())}
                                              >加入批注</ButtonV2>
                                            </Show>
                                            <Show when={props.onSendComment}>
                                              <ButtonV2
                                                variant="contrast"
                                                size="small"
                                                disabled={!commentDraft().trim()}
                                                onClick={() => submitLineComment(file, h, li())}
                                              >发送给 agent</ButtonV2>
                                            </Show>
                                          </div>
                                        </div>
                                      </Show>
                                      </>
                                    )
                                  }}
                                </For>
                              </pre>
                              <Show when={commentingOn() === key}>
                                <div class="mafw-diff-comment" onClick={(e) => e.preventDefault()}>
                                  <textarea
                                    class="mafw-diff-comment-input"
                                    rows={3}
                                    placeholder="对这处改动有什么意见？（回喂给 agent 修正）"
                                    value={commentDraft()}
                                    onInput={(e) => setCommentDraft(e.currentTarget.value)}
                                  />
                                  <div class="mafw-diff-comment-actions">
                                    <ButtonV2 variant="ghost" size="small" onClick={() => setCommentingOn(null)}>取消</ButtonV2>
                                    <Show when={props.onAddAnnotation}>
                                      <ButtonV2
                                        variant="outline"
                                        size="small"
                                        disabled={!commentDraft().trim()}
                                        onClick={() => submitDraftComment(file, h)}
                                      >加入批注</ButtonV2>
                                    </Show>
                                    <Show when={props.onSendComment}>
                                      <ButtonV2
                                        variant="contrast"
                                        size="small"
                                        disabled={!commentDraft().trim()}
                                        onClick={() => submitComment(file, h)}
                                      >发送给 agent</ButtonV2>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                            </label>
                          )
                        }}
                      </For>
                    </section>
                  )
                }}
              </Show>
            </div>
          </Show>
        </Show>
      </div>
      <footer class="mafw-diff-panel-footer">
        <span class="mafw-diff-panel-count">已选 {totalSel()} 个 hunk</span>
        <ButtonV2 variant="contrast" size="small" disabled={busy() || totalSel() === 0} onClick={() => void revertSelected()}>
          {busy() ? "回退中…" : "回退选中"}
        </ButtonV2>
      </footer>
    </div>
  )
}
