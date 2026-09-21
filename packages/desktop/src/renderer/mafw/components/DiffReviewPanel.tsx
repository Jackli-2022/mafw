// DiffReviewPanel（切片 2）：会话改动逐 hunk 审阅。
// 数据源优先 props.diffs（SSE session.diff 实时快照），空则拉 GET /sessions/:id/diff。
// 勾选 hunk → POST /sessions/:id/diff/revert（gateway 反转 patch 后 vcs.apply）→ 刷新。
import { Show, For, createSignal, createMemo, createEffect } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { splitHunks, hunkStats, pickSelectedFile, buildDiffCommentPrompt, type DiffHunk } from "./diff-hunks"
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
  /** SSE session.diff 实时快照（可空 → 组件自行拉取） */
  diffs?: FileDiffEntry[]
  onClose: () => void
  /** 行级评论回喂（可选）：组装好的评论 prompt 发到会话 */
  onSendComment?: (sessionID: string, text: string) => void
}) {
  const [fetched, setFetched] = createSignal<FileDiffEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  // 两栏：左文件列表 + 右当前文件 hunks（opencode v2 ReviewPanel 模式）
  const [selectedFileRaw, setSelectedFile] = createSignal<string | null>(null)
  // 行级评论：commentingOn = 正在评论的 hunk key
  const [commentingOn, setCommentingOn] = createSignal<string | null>(null)
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
    if (props.diffs && props.diffs.length > 0) return
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

  return (
    <div class="mafw-diff-panel" role="dialog" aria-label="审阅改动">
      <header class="mafw-diff-panel-header">
        <h2>审阅改动</h2>
        <div class="mafw-diff-panel-actions">
          <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={() => void refresh()}>刷新</ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onClose()}>关闭</ButtonV2>
        </div>
      </header>
      <p class="mafw-diff-panel-hint">勾选要撤销的 hunk，点「回退选中」。未勾选的改动保持不变。</p>
      <div class="mafw-diff-panel-body">
        <Show when={!loading()} fallback={<p class="mafw-diff-panel-empty">加载中…</p>}>
          <Show
            when={files().length > 0}
            fallback={<p class="mafw-diff-panel-empty">当前会话没有待审的文件改动。</p>}
          >
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
            <div class="mafw-diff-detail">
              <Show when={currentFile()}>
                {(f) => {
                  const file = fileName(f())
                  const { hunks } = splitHunks(f().patch ?? "")
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
                                onChange={() => toggle(key)}
                              />
                              <span class="mafw-diff-hunk-header">{h.header}</span>
                              <span class="mafw-diff-stat add">+{stats.added}</span>
                              <span class="mafw-diff-stat del">-{stats.removed}</span>
                              <Show when={props.onSendComment}>
                                <ButtonV2
                                  variant="ghost"
                                  size="small"
                                  class="mafw-diff-comment-btn"
                                  onClick={(e: MouseEvent) => { e.preventDefault(); setCommentingOn(commentingOn() === key ? null : key); setCommentDraft("") }}
                                >评论</ButtonV2>
                              </Show>
                              <pre class="mafw-diff-hunk-body">
                                <For each={h.lines}>
                                  {(line) => (
                                    <span
                                      classList={{
                                        "mafw-diff-line": true,
                                        add: line.startsWith("+"),
                                        del: line.startsWith("-"),
                                      }}
                                    >{line}</span>
                                  )}
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
                                    <ButtonV2
                                      variant="contrast"
                                      size="small"
                                      disabled={!commentDraft().trim()}
                                      onClick={() => submitComment(file, h)}
                                    >发送给 agent</ButtonV2>
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
