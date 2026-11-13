// 左栏「改动」面：上下文选择 + 会话改动树。
// 后续 slice 会补 Goal 版本差异、评审项与项目索引；本文件保持单一入口。
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { DockBanner, DockEmpty } from "./dock-panel"
import { buildChangeTree, changeStatusLetter, type ChangeTreeNode } from "./change-tree"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { ChangesContext, ChangesMode, GoalRef } from "../changes/changes-context"
import type { ChangesRequest } from "../changes/changes-request"
import { changeTotals, goalDiffErrorText, pinGoalRevision, toFileDiffEntries } from "../changes/goal-changes"
import { podHttpStatus } from "../pod-model"
import type { OpenDiffInput } from "../documents/diff-documents"

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
  request?: ChangesRequest | null
  projectDir: string | null
  sessionDiffs: readonly FileDiffEntry[]
  onOpenFile: (rel: string) => void
  onOpenSessionDiff?: (file: FileDiffEntry) => void
  resolveGoalDir?: (goal: GoalRef) => Promise<string | null>
  onOpenDiff?: (input: OpenDiffInput) => void
}

function ChangeRows(props: {
  nodes: readonly ChangeTreeNode[]
  depth: number
  onOpenFile: (rel: string) => void
  onOpenDiff?: (file: FileDiffEntry) => void
}): JSX.Element {
  const openNode = (node: ChangeTreeNode) => {
    if (props.onOpenDiff && node.file?.patch) props.onOpenDiff(node.file)
    else props.onOpenFile(node.path)
  }
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
              onClick={() => openNode(node)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                openNode(node)
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
          <ChangeRows nodes={node.children} depth={props.depth + 1} onOpenFile={props.onOpenFile} onOpenDiff={props.onOpenDiff} />
        </Show>
      )}
    </For>
  )
}

export function ChangesFace(props: ChangesFaceProps): JSX.Element {
  let sessionRef: HTMLDivElement | undefined
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

  const [displayedGoal, setDisplayedGoal] = createSignal<GoalRef | null>(null)
  const [newerRevision, setNewerRevision] = createSignal<number | null>(null)
  const [goalFiles, setGoalFiles] = createSignal<FileDiffEntry[]>([])
  const [goalLoading, setGoalLoading] = createSignal(false)
  const [goalError, setGoalError] = createSignal<string | null>(null)

  createEffect(() => {
    const context = props.context
    if (context?.kind !== "goal") {
      setDisplayedGoal(null)
      setNewerRevision(null)
      return
    }
    const pin = pinGoalRevision(displayedGoal(), context.goal)
    if (pin.displayed !== displayedGoal()) setDisplayedGoal(pin.displayed)
    setNewerRevision(pin.newerRevision)
  })

  createEffect(() => {
    const goal = displayedGoal()
    if (!goal) {
      setGoalFiles([])
      setGoalError(null)
      return
    }
    let live = true
    setGoalLoading(true)
    setGoalError(null)
    void window.api.mafw.pod.worktreeDiff(goal.podId, goal.goalId, goal.revision)
      .then((diff) => {
        if (!live) return
        setGoalFiles(toFileDiffEntries(Array.isArray(diff?.files) ? diff.files : []))
      })
      .catch((error: unknown) => {
        if (!live) return
        setGoalFiles([])
        setGoalError(goalDiffErrorText(podHttpStatus(error)))
      })
      .finally(() => { if (live) setGoalLoading(false) })
    return () => { live = false }
  })

  const goalTotals = createMemo(() => changeTotals(goalFiles()))
  const goalTree = createMemo(() => buildChangeTree(goalFiles()))

  const openGoalFile = async (file: FileDiffEntry) => {
    const goal = displayedGoal()
    if (!goal || !file.file) return
    const root = goal.worktreeDir ?? await props.resolveGoalDir?.(goal)
    if (!root) {
      setGoalError("这一版的分支不可用")
      return
    }
    props.onOpenDiff?.({
      source: { kind: "goal", podId: goal.podId, goalId: goal.goalId, revision: goal.revision },
      root,
      scope: {
        kind: "goal",
        worldId: props.projectDir ?? "",
        goalId: goal.goalId,
        revision: goal.revision,
        worktreeDir: root,
      },
      rel: file.file,
      patch: file.patch ?? "",
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      status: file.status,
    })
  }

  createEffect(on(() => props.request?.seq, () => {
    const request = props.request
    if (!request) return
    props.onMode(request.context.kind)
    queueMicrotask(() => {
      if (request.section === "review") return
      sessionRef?.scrollIntoView({ block: "nearest" })
    })
  }, { defer: true }))

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
              <Show
                when={context().kind === "goal" && displayedGoal()}
                fallback={<DockEmpty icon="review" text="项目改动待接入" hint="后续 slice 接入项目索引" />}
              >
                {(goal) => (
                  <div class="mafw-changes-section">
                    <Show when={newerRevision()}>
                      {(revision) => (
                        <DockBanner
                          kind="info"
                          text={`有新版本 rev ${revision()} · 切换`}
                          action={{
                            label: "切换",
                            onClick: () => {
                              const contextValue = props.context
                              if (contextValue?.kind === "goal") {
                                setDisplayedGoal(contextValue.goal)
                                setNewerRevision(null)
                              }
                            },
                          }}
                        />
                      )}
                    </Show>
                    <div class="mafw-changes-section-head">
                      <span>本版变更 · Goal「{goal().title}」rev {goal().revision}</span>
                      <Show when={goalTotals().files > 0}>
                        <span class="mafw-changes-stats">
                          {goalTotals().files} 个文件 <span class="mafw-diff-stat add">+{goalTotals().additions}</span>{" "}
                          <span class="mafw-diff-stat del">-{goalTotals().deletions}</span>
                        </span>
                      </Show>
                    </div>
                    <Show when={goalError()}>
                      <DockBanner kind="error" text={goalError()!} />
                    </Show>
                    <Show when={!goalLoading() && !goalError() && goalFiles().length === 0}>
                      <DockEmpty icon="review" text="这一版还没有变更" hint="执行或直接编辑产生 diff 后会出现在这里" />
                    </Show>
                    <Show when={goalLoading()}>
                      <DockEmpty icon="review" text="正在读取这一版变更…" />
                    </Show>
                    <Show when={!goalLoading() && !goalError() && goalFiles().length > 0}>
                      <div class="mafw-changes-face-tree">
                        <ChangeRows nodes={goalTree()} depth={0} onOpenFile={() => {}} onOpenDiff={openGoalFile} />
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
            }
          >
            <div class="mafw-changes-section" ref={(el) => { sessionRef = el }}>
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
                  <ChangeRows nodes={tree()} depth={0} onOpenFile={props.onOpenFile} onOpenDiff={props.onOpenSessionDiff} />
                </div>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}
