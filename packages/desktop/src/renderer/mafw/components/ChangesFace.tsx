// 左栏「改动」面：上下文选择 + 会话改动树。
// 后续 slice 会补 Goal 版本差异、评审项与项目索引；本文件保持单一入口。
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { DockBanner, DockEmpty } from "./dock-panel"
import { buildChangeTree, changeStatusLetter, nextPulseState, type ChangeTreeNode } from "./change-tree"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { ChangesContext, ChangesMode, GoalRef } from "../changes/changes-context"
import type { ChangesRequest } from "../changes/changes-request"
import { changeTotals, goalDiffErrorText, pinGoalRevision, toFileDiffEntries } from "../changes/goal-changes"
import { reviewActionsVisible } from "../changes/review-queue"
import { canReopenReviewItem, canResolveReviewItem, reviewStatusLabel } from "../pod-review-model"
import { podHttpStatus } from "../pod-model"
import type { OpenDiffInput } from "../documents/diff-documents"
import type { PodGoal, PodReviewItem } from "@mafw/sdk"

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
  liveDiffs?: readonly FileDiffEntry[]
  onOpenFile: (rel: string) => void
  onOpenSessionDiff?: (file: FileDiffEntry) => void
  resolveGoalDir?: (goal: GoalRef) => Promise<string | null>
  onOpenDiff?: (input: OpenDiffInput) => void
  onOpenGoalFile?: (goal: GoalRef, rel: string, line?: number) => void
  accepted?: boolean
  onReviewChanged?: () => void
  goals?: readonly PodGoal[]
  sessions?: readonly { id: string; title: string }[]
  reviewCountForGoal?: (goalId: string) => number
  onOpenGoal?: (goalId: string) => void
  onOpenSession?: (sessionID: string) => void
}

function ChangeRows(props: {
  nodes: readonly ChangeTreeNode[]
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  pulse?: Set<string>
  onOpenFile: (rel: string) => void
  onOpenDiff?: (file: FileDiffEntry) => void
}): JSX.Element {
  const openNode = (node: ChangeTreeNode) => {
    if (props.onOpenDiff && node.file?.patch) props.onOpenDiff(node.file)
    else props.onOpenFile(node.path)
  }
  return (
    <For each={props.nodes}>
      {(node) => {
        const open = () => !props.collapsed.has(node.path)
        return (
        <Show
          when={node.kind === "dir"}
          fallback={
            <div
              class="mafw-change-file mafw-changes-face-row"
              classList={{ "mafw-change-pulse": props.pulse?.has(node.path) === true }}
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
            role="button"
            tabIndex={0}
            aria-expanded={open()}
            aria-label={node.path}
            onClick={() => props.onToggle(node.path)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              props.onToggle(node.path)
            }}
          >
            <span class="mafw-change-name">{node.name}</span>
            <span class="mafw-diff-stat add">+{node.additions}</span>
            <span class="mafw-diff-stat del">-{node.deletions}</span>
          </div>
          <Show when={open()}>
            <ChangeRows
              nodes={node.children}
              depth={props.depth + 1}
              collapsed={props.collapsed}
              onToggle={props.onToggle}
              pulse={props.pulse}
              onOpenFile={props.onOpenFile}
              onOpenDiff={props.onOpenDiff}
            />
          </Show>
        </Show>
        )
      }}
    </For>
  )
}

export function ChangesFace(props: ChangesFaceProps): JSX.Element {
  let sessionRef: HTMLDivElement | undefined
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  const [pulse, setPulse] = createSignal<Set<string>>(new Set())
  let prevLive: FileDiffEntry[] | null = null
  let liveSeen = false
  let pulseTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const live = props.liveDiffs
    if (!Array.isArray(live)) return
    const step = nextPulseState(prevLive, liveSeen, [...live])
    liveSeen = step.seen
    prevLive = step.prev
    if (step.changed.size === 0) return
    setPulse(step.changed)
    if (pulseTimer) clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => setPulse(new Set()), 1200)
  })
  onCleanup(() => { if (pulseTimer) clearTimeout(pulseTimer) })
  const toggleCollapsed = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
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

  const [reviewItems, setReviewItems] = createSignal<PodReviewItem[]>([])
  const [reviewBusy, setReviewBusy] = createSignal(false)
  const [reviewError, setReviewError] = createSignal<string | null>(null)
  const [reviewRefresh, setReviewRefresh] = createSignal(0)
  const [expandedReview, setExpandedReview] = createSignal<string | null>(null)

  const reviewGoal = createMemo<GoalRef | null>(() => {
    const context = props.context
    if (!context) return null
    if (context.kind === "goal") return displayedGoal()
    if (context.kind === "session") return context.goal
    return null
  })

  createEffect(() => {
    const goal = reviewGoal()
    reviewRefresh()
    if (!goal) {
      setReviewItems([])
      setReviewError(null)
      return
    }
    let live = true
    setReviewBusy(true)
    setReviewError(null)
    void window.api.mafw.pod.reviewItems(goal.podId, goal.goalId, { revision: goal.revision })
      .then((list) => {
        if (!live) return
        setReviewItems(Array.isArray(list?.items) ? list.items : [])
      })
      .catch((error: unknown) => {
        if (!live) return
        setReviewItems([])
        setReviewError("评审意见加载失败")
      })
      .finally(() => { if (live) setReviewBusy(false) })
    return () => { live = false }
  })

  const reviewWhere = (item: PodReviewItem): string => {
    if (item.startLine == null) return item.rel
    if (item.endLine == null || item.endLine === item.startLine) return `${item.rel}:L${item.startLine}`
    return `${item.rel}:L${item.startLine}-${item.endLine}`
  }

  const openReviewItem = (item: PodReviewItem) => {
    const goal = reviewGoal()
    if (!goal) return
    const file = goalFiles().find((entry) => entry.file === item.rel)
    if (file) {
      void openGoalFile(file, item.startLine ?? undefined)
      return
    }
    props.onOpenGoalFile?.(goal, item.rel, item.startLine ?? undefined)
  }

  const resolveReview = async (item: PodReviewItem) => {
    const goal = reviewGoal()
    if (!goal || reviewBusy()) return
    setReviewBusy(true)
    try {
      await window.api.mafw.pod.resolveReviewItem(goal.podId, goal.goalId, item.id)
      setReviewRefresh((value) => value + 1)
      props.onReviewChanged?.()
    } catch (error: any) {
      setReviewError(String(error?.message ?? error).slice(0, 160) || "确认解决失败")
    } finally {
      setReviewBusy(false)
    }
  }

  const reopenReview = async (item: PodReviewItem) => {
    const goal = reviewGoal()
    if (!goal || reviewBusy()) return
    setReviewBusy(true)
    try {
      await window.api.mafw.pod.reopenReviewItem(goal.podId, goal.goalId, item.id)
      setReviewRefresh((value) => value + 1)
      props.onReviewChanged?.()
    } catch (error: any) {
      setReviewError(String(error?.message ?? error).slice(0, 160) || "重新打开失败")
    } finally {
      setReviewBusy(false)
    }
  }

  const reviewSection = () => (
    <Show when={reviewItems().length > 0 || reviewError()}>
      <div class="mafw-changes-review">
        <div class="mafw-changes-section-head">
          <span>待审</span>
          <span class="mafw-changes-stats">
            {reviewItems().filter((item) => item.status !== "resolved").length} 条未解决
          </span>
        </div>
        <Show when={reviewError()}>
          <DockBanner kind="error" text={reviewError()!} />
        </Show>
        <For each={reviewItems()}>
          {(item) => (
            <div class="mafw-changes-review-item" data-status={item.status}>
              <div
                class="mafw-changes-review-row"
                role="button"
                tabIndex={0}
                onClick={() => setExpandedReview(expandedReview() === item.id ? null : item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  setExpandedReview(expandedReview() === item.id ? null : item.id)
                }}
              >
                <span class="mafw-changes-review-status">{reviewStatusLabel(item.status)}</span>
                <span class="mafw-changes-review-path" onClick={(event) => { event.stopPropagation(); openReviewItem(item) }}>
                  {reviewWhere(item)}
                </span>
              </div>
              <Show when={expandedReview() === item.id}>
                <div class="mafw-changes-review-body">
                  <div class="mafw-changes-review-comment">{item.comment}</div>
                  <Show when={item.response}>
                    <div class="mafw-changes-review-response">
                      <span>Tech Lead 回应</span>
                      <span>{item.response}</span>
                    </div>
                  </Show>
                  <Show when={reviewActionsVisible(props.accepted ?? false)}>
                    <div class="mafw-changes-review-actions">
                      <Show when={canResolveReviewItem(item)}>
                        <ButtonV2 variant="outline" size="small" disabled={reviewBusy()} onClick={() => void resolveReview(item)}>
                          确认解决
                        </ButtonV2>
                      </Show>
                      <Show when={canReopenReviewItem(item)}>
                        <ButtonV2 variant="ghost" size="small" disabled={reviewBusy()} onClick={() => void reopenReview(item)}>
                          重新打开
                        </ButtonV2>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )

  const openGoalFile = async (file: FileDiffEntry, anchorLine?: number) => {
    const goal = reviewGoal()
    if (!goal || !file.file) return
    const candidate = goal.worktreeDir && goal.worktreeDir !== props.projectDir ? goal.worktreeDir : null
    const root = candidate ?? await props.resolveGoalDir?.(goal)
    if (!root || root === props.projectDir) {
      setGoalError("这一版没有可预览的分支")
      return
    }
    setGoalError(null)
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
      anchorLine,
    })
  }

  let lastRequestSeq = 0
  createEffect(() => {
    const request = props.request
    if (!request || request.seq <= lastRequestSeq) return
    lastRequestSeq = request.seq
    props.onMode(request.context.kind)
    queueMicrotask(() => {
      if (request.section === "review") return
      sessionRef?.scrollIntoView({ block: "nearest" })
    })
  })

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

      {reviewSection()}
      <Show when={props.context} fallback={<DockEmpty icon="folder" text="当前上下文不可用" hint="打开一个项目或讨论后再试" />}>
        {(context) => (
          <Show
            when={context().kind === "session"}
            fallback={
              <Show
                when={context().kind === "goal" && displayedGoal()}
                fallback={
                  <div class="mafw-changes-project">
                    <div class="mafw-changes-section-head"><span>项目</span><span class="mafw-changes-stats">选择上下文</span></div>
                    <div class="mafw-changes-section-head"><span>Goal</span></div>
                    <For each={props.goals ?? []}>
                      {(goal) => {
                        const revision = goal.activeRevision ?? goal.revision ?? 1
                        const pending = props.reviewCountForGoal?.(goal.goalId) ?? 0
                        return (
                          <div
                            class="mafw-changes-project-row"
                            role="button"
                            tabIndex={0}
                            onClick={() => props.onOpenGoal?.(goal.goalId)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return
                              event.preventDefault()
                              props.onOpenGoal?.(goal.goalId)
                            }}
                          >
                            <span class="mafw-changes-project-name">{goal.title}</span>
                            <span class="mafw-changes-stats">rev {revision} · {goal.status}</span>
                            <Show when={pending > 0}><span class="mafw-changes-project-badge">{pending}</span></Show>
                          </div>
                        )
                      }}
                    </For>
                    <div class="mafw-changes-section-head"><span>讨论</span></div>
                    <For each={props.sessions ?? []}>
                      {(session) => (
                        <div
                          class="mafw-changes-project-row"
                          role="button"
                          tabIndex={0}
                          onClick={() => props.onOpenSession?.(session.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return
                            event.preventDefault()
                            props.onOpenSession?.(session.id)
                          }}
                        >
                          <span class="mafw-changes-project-name">{session.title}</span>
                        </div>
                      )}
                    </For>
                  </div>
                }
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
                        <ChangeRows nodes={goalTree()} depth={0} collapsed={collapsed()} onToggle={toggleCollapsed} pulse={pulse()} onOpenFile={() => {}} onOpenDiff={openGoalFile} />
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
                  <ChangeRows nodes={tree()} depth={0} collapsed={collapsed()} onToggle={toggleCollapsed} pulse={pulse()} onOpenFile={props.onOpenFile} onOpenDiff={props.onOpenSessionDiff} />
                </div>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}
