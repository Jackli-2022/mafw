import { Show, type JSX } from "solid-js"
import { ChangesDock } from "./ChangesDock"
import { DockEmpty } from "./dock-panel"
import type { FileDiffEntry } from "./DiffReviewPanel"

/** 变更集舞台：复用 ChangesDock；没有 diff 时给出明确空态。 */
export function ChangeSetStage(props: {
  sessionID: string | null
  sessionDirectory: string | null
  diffs: FileDiffEntry[]
  onSendComment?: (sid: string, text: string) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
  }) => void
}): JSX.Element {
  return (
    <div class="mafw-change-set-stage">
      <Show
        when={props.diffs.length > 0}
        fallback={
          <DockEmpty
            icon="code-lines"
            text="这个 revision 还没有变更"
            hint="执行或直接编辑产生 diff 后会出现在这里"
          />
        }
      >
        <ChangesDock
          sessionID={props.sessionID}
          sessionDirectory={props.sessionDirectory}
          diffs={props.diffs}
          onSendComment={props.onSendComment}
          onAddAnnotation={props.onAddAnnotation}
        />
      </Show>
    </div>
  )
}
