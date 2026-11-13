// 左栏「改动」面：上下文选择 + 会话改动树。
// 后续 slice 会补 Goal 版本差异、评审项与项目索引；本文件保持单一入口。
import { For, Show, createMemo, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { DockEmpty } from "./dock-panel"
import { buildChangeTree, changeStatusLetter, type ChangeTreeNode } from "./change-tree"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { ChangesContext, ChangesMode } from "../changes/changes-context"

const MODE_LABEL: Record<ChangesMode, string> = {
  session: "当前讨论",
  goal: "当前 Goal",
  project: "项目",
}

const MODES: readonly ChangesMode[] = ["session", "goal", "project"]

export type ChangesFaceProps = {
  mode: ChangesMode
  onMode: (mode: ChangesMode) => void
  availableModes?: readonly ChangesMode[]
  context: ChangesContext | null
  sessionDiffs: readonly FileDiffEntry[]
  onOpenFile: (rel: string) => void
}

function ChangeRows(props: {
  nodes: readonly ChangeTreeNode[]
  depth: number
  onOpenFile: (rel: string) => void
}): JSX.Element {
  return (
    <For each={props.nodes}>
      {(node) => (
        <Show
          when={node.kind === "dir"}
          fallback={
            <div
              class="mafw-change-file mafw-changes-face-row"
              style={{ "padding-left": `${8 + props.depth * 12}px` }}
              role="button"
              tabIndex={0}
              aria-label={node.path}
              onClick={() => props.onOpenFile(node.path)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                props.onOpenFile(node.path)
              }}
            >
              <span class="mafw-change-name">{node.name}</span>
              <Show when={changeStatusLetter(node.status)}>
                <span class="mafw-change-status" data-status={node.status}>
                  {changeStatusLetter(node.status)}
                </span>
              </Show>
              <span class="mafw-diff-stat add">+{node.additions}</span>
              <span class="mafw-diff-stat del">-{node.deletions}</span>
            </div>
          }
        >
          <div
            class="mafw-change-dir mafw-changes-face-row"
            style={{ "padding-left": `${8 + props.depth * 12}px` }}
            aria-label={node.path}
          >
            <span class="mafw-change-name">{node.name}</span>
            <span class="mafw-diff-stat add">+{node.additions}</span>
            <span class="mafw-diff-stat del">-{node.deletions}</span>
          </div>
          <ChangeRows nodes={node.children} depth={props.depth + 1} onOpenFile={props.onOpenFile} />
        </Show>
      )}
    </For>
  )
}

export function ChangesFace(props: ChangesFaceProps): JSX.Element {
  const tree = createMemo(() => buildChangeTree([...props.sessionDiffs]))
  const totals = createMemo(() => props.sessionDiffs.reduce<{
    files: number
    additions: number
    deletions: number
  }>(
    (sum, file) => ({
      files: sum.files + 1,
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { files: 0, additions: 0, deletions: 0 },
  ))

  return (
    <div class="mafw-changes-face" aria-label="改动">
      <div class="mafw-changes-mode" role="tablist" aria-label="改动上下文">
        <For each={MODES}>
          {(mode) => {
            const enabled = () => props.availableModes === undefined || props.availableModes.includes(mode)
            return (
              <TooltipV2 value={enabled() ? MODE_LABEL[mode] : "没有可用的讨论 / Goal"} openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-changes-mode-btn"
                  aria-pressed={props.mode === mode}
                  disabled={!enabled()}
                  onClick={() => props.onMode(mode)}
                >
                  {MODE_LABEL[mode]}
                </ButtonV2>
              </TooltipV2>
            )
          }}
        </For>
      </div>

      <Show when={props.context} fallback={<DockEmpty icon="folder" text="当前上下文不可用" hint="打开一个项目或讨论后再试" />}>
        {(context) => (
          <Show
            when={context().kind === "session"}
            fallback={
              <DockEmpty
                icon="review"
                text={context().kind === "goal" ? "Goal 改动待接入" : "项目改动待接入"}
                hint="后续 slice 接入版本差异与评审项"
              />
            }
          >
            <div class="mafw-changes-section">
              <div class="mafw-changes-section-head">
                <span>本会话改动</span>
                <Show when={totals().files > 0}>
                  <span class="mafw-changes-stats">
                    {totals().files} 个文件 <span class="mafw-diff-stat add">+{totals().additions}</span>{" "}
                    <span class="mafw-diff-stat del">-{totals().deletions}</span>
                  </span>
                </Show>
              </div>
              <Show
                when={tree().length > 0}
                fallback={<DockEmpty icon="review" text="本次讨论还没有改动" hint="agent 修改文件后会实时出现在这里" />}
              >
                <div class="mafw-changes-face-tree">
                  <ChangeRows nodes={tree()} depth={0} onOpenFile={props.onOpenFile} />
                </div>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}
