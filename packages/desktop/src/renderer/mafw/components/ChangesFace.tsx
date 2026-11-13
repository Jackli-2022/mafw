// 左栏「改动」：Goal 组在前、讨论组在后；组与单项都可收起。
// 点 Goal / 讨论标题打开对象 tab；点 revision / turn 打开对应的改动集 tab。
import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { Icon } from "@mafw/ui/icon"
import { DockBanner, DockEmpty } from "./dock-panel"
import {
  buildDiscussionGroups,
  buildGoalGroups,
  filterDiscussionGroups,
  filterGoalGroups,
  type ChangesFilter,
  type DiscussionChangeGroup,
  type GoalChangeGroup,
} from "../changes/changes-tree"
import type { SessionTurnChange } from "../changes/session-turns"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { ChangesRequest } from "../changes/changes-request"
import type { GoalRef } from "../changes/changes-context"
import { reviewActionsVisible } from "../changes/review-queue"
import { canReopenReviewItem, canResolveReviewItem, reviewStatusLabel } from "../pod-review-model"
import { podGoalStatusLabel } from "../pod-model"
import type { PodGoal, PodReviewItem } from "@mafw/sdk"

export type ChangesFaceProps = {
  goals: readonly PodGoal[]
  sessions: readonly { id: string; title: string }[]
  activeSessionID: string | null
  activeGoalId: string | null
  turns: readonly SessionTurnChange[]
  sessionDiffs: readonly FileDiffEntry[]
  reviewGoal: GoalRef | null
  request?: ChangesRequest | null
  accepted?: boolean
  onReviewChanged?: () => void
  reviewRefreshKey?: () => unknown
  reviewCountForGoal?: (goalId: string) => number
  onOpenGoal: (goalId: string) => void
  onOpenGoalChangeSet: (goal: PodGoal, revision: number) => void
  onOpenSession: (sessionID: string) => void
  onOpenTurnChangeSet: (turn: SessionTurnChange) => void
  onOpenSessionChangeSet: () => void
}

const FILTERS: readonly { id: ChangesFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "review", label: "待审" },
  { id: "changes", label: "有改动" },
]

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function ChangesFace(props: ChangesFaceProps): JSX.Element {
  const [query, setQuery] = createSignal("")
  const [filter, setFilter] = createSignal<ChangesFilter>("all")
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set())
  const [collapsedGoals, setCollapsedGoals] = createSignal<Set<string>>(new Set())
  const [expandedGoals, setExpandedGoals] = createSignal<Set<string>>(new Set())
  const [collapsedDiscussions, setCollapsedDiscussions] = createSignal<Set<string>>(new Set())
  const [expandedDiscussions, setExpandedDiscussions] = createSignal<Set<string>>(new Set())
  let reviewRef: HTMLDivElement | undefined

  const allGoals = createMemo(() =>
    buildGoalGroups({
      goals: props.goals,
      activeGoalId: props.activeGoalId,
      reviewCountForGoal: props.reviewCountForGoal,
    }),
  )
  const allDiscussions = createMemo(() =>
    buildDiscussionGroups({
      sessions: props.sessions,
      activeSessionID: props.activeSessionID,
      turns: props.turns,
      sessionDiffs: props.sessionDiffs,
    }),
  )
  const goals = createMemo(() => filterGoalGroups(allGoals(), query(), filter()))
  const discussions = createMemo(() => filterDiscussionGroups(allDiscussions(), query(), filter()))

  const groupCollapsed = (id: "goal" | "discussion") => collapsedGroups().has(id)
  const toggleGroup = (id: "goal" | "discussion") => setCollapsedGroups((previous) => toggleIn(previous, id))

  const goalExpanded = (group: GoalChangeGroup) =>
    group.current ? !collapsedGoals().has(group.id) : expandedGoals().has(group.id)
  const toggleGoal = (group: GoalChangeGroup) => {
    if (group.current) setCollapsedGoals((previous) => toggleIn(previous, group.id))
    else setExpandedGoals((previous) => toggleIn(previous, group.id))
  }

  const discussionExpanded = (group: DiscussionChangeGroup) =>
    group.current ? !collapsedDiscussions().has(group.id) : expandedDiscussions().has(group.id)
  const toggleDiscussion = (group: DiscussionChangeGroup) => {
    if (group.current) setCollapsedDiscussions((previous) => toggleIn(previous, group.id))
    else setExpandedDiscussions((previous) => toggleIn(previous, group.id))
  }

  // 评审项：Goal 级；左栏顶部保留「待审」区，深链只滚到这里。
  const [reviewItems, setReviewItems] = createSignal<PodReviewItem[]>([])
  const [reviewBusy, setReviewBusy] = createSignal(false)
  const [reviewError, setReviewError] = createSignal<string | null>(null)
  const [reviewRefresh, setReviewRefresh] = createSignal(0)
  const [expandedReview, setExpandedReview] = createSignal<string | null>(null)

  createEffect(() => {
    const goal = props.reviewGoal
    props.reviewRefreshKey?.()
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
      .catch(() => {
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

  const resolveReview = async (item: PodReviewItem) => {
    const goal = props.reviewGoal
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
    const goal = props.reviewGoal
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

  let lastRequestSeq = 0
  createEffect(() => {
    const request = props.request
    if (!request || request.seq <= lastRequestSeq) return
    lastRequestSeq = request.seq
    if (request.section !== "review") return
    queueMicrotask(() => reviewRef?.scrollIntoView({ block: "nearest" }))
  })

  const reviewSection = () => (
    <Show when={reviewItems().length > 0 || reviewError()}>
      <div class="mafw-changes-review" ref={(el) => { reviewRef = el }}>
        <div class="mafw-changes-group-head">
          <span class="mafw-changes-group-title">待审</span>
          <span class="mafw-changes-group-count">
            {reviewItems().filter((item) => item.status !== "resolved").length}
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
                <span class="mafw-changes-review-path">{reviewWhere(item)}</span>
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

  const currentGoalSummary = () => allGoals().find((group) => group.current) ?? null
  const currentDiscussionSummary = () => allDiscussions().find((group) => group.current) ?? null

  return (
    <div class="mafw-changes-face" aria-label="改动">
      <div class="mafw-changes-toolbar">
        <TextInputV2
          class="mafw-changes-search"
          appearance="base"
          placeholder="搜索 Goal / 讨论 / 文件"
          value={query()}
          leadingIcon={<Icon name="magnifying-glass" size="small" />}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <div class="mafw-changes-filter" role="group" aria-label="改动过滤">
          <For each={FILTERS}>
            {(item) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-changes-filter-btn"
                aria-pressed={filter() === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </ButtonV2>
            )}
          </For>
        </div>
      </div>

      {reviewSection()}

      <div class="mafw-changes-scroll">
        <section class="mafw-changes-group" aria-label="Goal">
          <div
            class="mafw-changes-group-head"
            role="button"
            tabIndex={0}
            aria-expanded={!groupCollapsed("goal")}
            onClick={() => toggleGroup("goal")}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              toggleGroup("goal")
            }}
          >
            <span class="mafw-changes-caret" aria-hidden="true">{groupCollapsed("goal") ? "▸" : "▾"}</span>
            <span class="mafw-changes-group-title">Goal</span>
            <span class="mafw-changes-group-count">{goals().length}</span>
          </div>

          <Show
            when={!groupCollapsed("goal")}
            fallback={
              <Show when={currentGoalSummary()}>
                {(group) => (
                  <div class="mafw-changes-summary">
                    <span class="mafw-changes-summary-main">
                      <span class="mafw-changes-row-title">{group().title}</span>
                      <span class="mafw-changes-row-sub">当前 Goal · rev {group().activeRevision}</span>
                    </span>
                    <Show when={group().pendingReview > 0}>
                      <span class="mafw-changes-badge">{group().pendingReview}</span>
                    </Show>
                  </div>
                )}
              </Show>
            }
          >
            <Show when={goals().length > 0} fallback={<DockEmpty icon="dot-grid" text="没有匹配的 Goal" />}>
              <For each={goals()}>
                {(group) => (
                  <div class="mafw-changes-node" classList={{ "is-current": group.current }}>
                    <div
                      class="mafw-changes-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={goalExpanded(group)}
                      onClick={() => props.onOpenGoal(group.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowRight") {
                          event.preventDefault()
                          if (!goalExpanded(group)) toggleGoal(group)
                          return
                        }
                        if (event.key === "ArrowLeft") {
                          event.preventDefault()
                          if (goalExpanded(group)) toggleGoal(group)
                          return
                        }
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        props.onOpenGoal(group.id)
                      }}
                    >
                      <span
                        class="mafw-changes-caret"
                        aria-hidden="true"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleGoal(group)
                        }}
                      >
                        {goalExpanded(group) ? "▾" : "▸"}
                      </span>
                      <span class="mafw-changes-row-main">
                        <span class="mafw-changes-row-title">{group.title}</span>
                        <span class="mafw-changes-row-sub">
                          rev {group.activeRevision} · {podGoalStatusLabel(group.goal.status)}
                        </span>
                      </span>
                      <Show when={group.current}>
                        <span class="mafw-changes-current">当前</span>
                      </Show>
                      <Show when={group.pendingReview > 0}>
                        <span class="mafw-changes-badge">{group.pendingReview}</span>
                      </Show>
                    </div>
                    <Show when={goalExpanded(group)}>
                      <For each={group.revisions}>
                        {(revision) => (
                          <div
                            class="mafw-changes-row is-child"
                            role="button"
                            tabIndex={0}
                            onClick={() => props.onOpenGoalChangeSet(group.goal, revision.revision)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return
                              event.preventDefault()
                              props.onOpenGoalChangeSet(group.goal, revision.revision)
                            }}
                          >
                            <span class="mafw-changes-row-main">
                              <span class="mafw-changes-row-title">rev {revision.revision}{revision.current ? " · 当前版本" : ""}</span>
                              <span class="mafw-changes-row-sub">{revision.current ? "本版变更" : "历史版本"}</span>
                            </span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </section>

        <section class="mafw-changes-group" aria-label="讨论">
          <div
            class="mafw-changes-group-head"
            role="button"
            tabIndex={0}
            aria-expanded={!groupCollapsed("discussion")}
            onClick={() => toggleGroup("discussion")}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              toggleGroup("discussion")
            }}
          >
            <span class="mafw-changes-caret" aria-hidden="true">{groupCollapsed("discussion") ? "▸" : "▾"}</span>
            <span class="mafw-changes-group-title">讨论</span>
            <span class="mafw-changes-group-count">{discussions().length}</span>
          </div>

          <Show
            when={!groupCollapsed("discussion")}
            fallback={
              <Show when={currentDiscussionSummary()}>
                {(group) => (
                  <div class="mafw-changes-summary">
                    <span class="mafw-changes-summary-main">
                      <span class="mafw-changes-row-title">{group().title}</span>
                      <span class="mafw-changes-row-sub">
                        当前讨论 · {group().turns.length} 个改动回合
                      </span>
                    </span>
                  </div>
                )}
              </Show>
            }
          >
            <Show when={discussions().length > 0} fallback={<DockEmpty icon="bubble-5" text="没有匹配的讨论" />}>
              <For each={discussions()}>
                {(group) => (
                  <div class="mafw-changes-node" classList={{ "is-current": group.current }}>
                    <div
                      class="mafw-changes-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={discussionExpanded(group)}
                      onClick={() => props.onOpenSession(group.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowRight") {
                          event.preventDefault()
                          if (!discussionExpanded(group)) toggleDiscussion(group)
                          return
                        }
                        if (event.key === "ArrowLeft") {
                          event.preventDefault()
                          if (discussionExpanded(group)) toggleDiscussion(group)
                          return
                        }
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        props.onOpenSession(group.id)
                      }}
                    >
                      <span
                        class="mafw-changes-caret"
                        aria-hidden="true"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleDiscussion(group)
                        }}
                      >
                        {discussionExpanded(group) ? "▾" : "▸"}
                      </span>
                      <span class="mafw-changes-row-main">
                        <span class="mafw-changes-row-title">{group.title}</span>
                        <span class="mafw-changes-row-sub">
                          {group.current
                            ? `${group.fileCount} 个文件 · ${group.turns.length} 个改动回合`
                            : "切换到此讨论查看改动"}
                        </span>
                      </span>
                      <Show when={group.current}>
                        <span class="mafw-changes-current">当前</span>
                      </Show>
                    </div>

                    <Show when={discussionExpanded(group)}>
                      <Show
                        when={group.turns.length > 0}
                        fallback={
                          <div class="mafw-changes-row is-child is-muted" role="note">
                            <span class="mafw-changes-row-main">
                              <span class="mafw-changes-row-title">还没有按回合记录的改动</span>
                            </span>
                          </div>
                        }
                      >
                        <div
                          class="mafw-changes-row is-child"
                          role="button"
                          tabIndex={0}
                          onClick={() => props.onOpenSessionChangeSet()}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return
                            event.preventDefault()
                            props.onOpenSessionChangeSet()
                          }}
                        >
                          <span class="mafw-changes-row-main">
                            <span class="mafw-changes-row-title">全部改动</span>
                            <span class="mafw-changes-row-sub">整个讨论的合并改动集</span>
                          </span>
                          <span class="mafw-changes-stats">
                            {group.fileCount} files
                          </span>
                        </div>
                        <For each={group.turns}>
                          {(turn) => (
                            <div
                              class="mafw-changes-row is-child"
                              role="button"
                              tabIndex={0}
                              onClick={() => props.onOpenTurnChangeSet(turn)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return
                                event.preventDefault()
                                props.onOpenTurnChangeSet(turn)
                              }}
                            >
                              <span class="mafw-changes-row-main">
                                <span class="mafw-changes-row-title">
                                  {turn.timeLabel ? `${turn.timeLabel} ` : ""}{turn.title}
                                </span>
                                <span class="mafw-changes-row-sub">{turn.files.length} files</span>
                              </span>
                              <span class="mafw-changes-stats">
                                <span class="mafw-diff-stat add">+{turn.additions}</span>
                                <span class="mafw-diff-stat del">-{turn.deletions}</span>
                              </span>
                            </div>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </section>
      </div>
    </div>
  )
}
