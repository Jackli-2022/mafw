// Goal revision 变更集：不依赖 active session 目录，直接读 Pod revision worktree diff。
import { Show, createEffect, createSignal, type JSX } from "solid-js"
import { ChangesDock } from "./ChangesDock"
import { DockEmpty } from "./dock-panel"
import type { FileDiffEntry } from "./DiffReviewPanel"
import { podHttpStatus } from "../pod-model"

export function GoalChangeSetStage(props: {
  podId: string | null
  goalId: string
  revision: number
  sessionDirectory: string | null
  onSendComment?: (sid: string, text: string) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
  }) => void
}): JSX.Element {
  const [diffs, setDiffs] = createSignal<FileDiffEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const podId = props.podId
    const goalId = props.goalId
    const revision = props.revision
    if (!podId) {
      setDiffs([])
      setError("这个 Goal 没有可读取的 Pod worktree")
      return
    }
    let live = true
    setLoading(true)
    setError(null)
    void window.api.mafw.pod.worktreeDiff(podId, goalId, revision)
      .then((diff) => {
        if (!live) return
        setDiffs(Array.isArray(diff?.files) ? diff.files as FileDiffEntry[] : [])
      })
      .catch((err: any) => {
        if (!live) return
        const status = podHttpStatus(err)
        setDiffs([])
        setError(status === 404
          ? "这一版没有可预览的分支"
          : status === 409
            ? `分支差异不可读：${String(err?.message ?? err).slice(0, 140)}`
            : status === 503
              ? "当前 gateway 不支持分支差异预览"
              : String(err?.message ?? err) || "变更集加载失败")
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  })

  return (
    <Show
      when={!loading() && !error() && diffs().length > 0}
      fallback={
        <DockEmpty
          icon="code-lines"
          text={loading() ? "正在读取这一版变更…" : error() || "这个 revision 还没有变更"}
          hint={loading() ? undefined : "执行或直接编辑产生 diff 后会出现在这里"}
        />
      }
    >
      <ChangesDock
        sessionID={null}
        sessionDirectory={props.sessionDirectory}
        diffs={diffs()}
        onSendComment={props.onSendComment}
        onAddAnnotation={props.onAddAnnotation}
      />
    </Show>
  )
}
