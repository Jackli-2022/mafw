// 右工作台 › 执行：概览 + 待办/子代理/后台/轨迹。只读概览，不复制 ChatView 控制面。
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { summarizeExecution } from "../execution-summary"
import { descendantRows } from "../subagent-tree"
import { subagentRows } from "../subagent-store"
import { backgroundRows } from "../background-store"
import { rowsForSession } from "../background-tracker"
import { taskRows } from "../task-store"
import { TaskList } from "./TaskList"
import { SubagentDock } from "./SubagentDock"
import { BackgroundDock } from "./BackgroundDock"
import { TrajectoryDock } from "./TrajectoryDock"
import type { ExecutionSection } from "../workbench-views"

export type ExecutionViewProps = {
  section: ExecutionSection
  sessionID: string | null
  sessionDirectory: string | null
  todos: any[]
  hiddenTodos: any[]
  tokens: number
  started: number
  onClearHidden: () => void
  onClosePanel: () => void
  onOpenSubagent: (id: string) => void
  onOpenSection: (section: ExecutionSection) => void
  trajectoryLive: any[]
  trajectoryTurnLive: any | null
  usage: JSX.Element
}

export function ExecutionView(props: ExecutionViewProps) {
  const [usageOpen, setUsageOpen] = createSignal(false)
  const subagents = createMemo(() => descendantRows(subagentRows(), props.sessionID ?? ""))
  const background = createMemo(() => rowsForSession(backgroundRows(), props.sessionID ?? ""))
  const tasks = createMemo(() =>
    taskRows().filter((t) => !props.sessionID || t.parentSessionID === props.sessionID),
  )
  const summary = createMemo(() =>
    summarizeExecution({
      subagents: subagents(),
      background: background(),
      todos: props.todos,
      tasks: tasks(),
    }),
  )

  return (
    <div class="mafw-rw-execution">
      <div class="mafw-rw-exec-section" classList={{ "is-active": props.section === "overview" }}>
        <div class="mafw-rw-overview">
          <div class="mafw-rw-overview-head">
            <span class="mafw-rw-overview-title">当前 run</span>
            <span class="mafw-rw-overview-note">只读概览 · 控制在对话区</span>
          </div>

          <div class="mafw-rw-overview-cards">
            <ButtonV2 variant="ghost" class="mafw-rw-overview-card" onClick={() => props.onOpenSection("subagents")}>
              <span class="mafw-rw-overview-label">子代理</span>
              <strong>{summary().subagentRunning} 运行</strong>
              <span>{summary().subagentTotal} 总计</span>
            </ButtonV2>
            <ButtonV2 variant="ghost" class="mafw-rw-overview-card" onClick={() => props.onOpenSection("background")}>
              <span class="mafw-rw-overview-label">后台</span>
              <strong>{summary().backgroundRunning} 运行</strong>
              <span>{summary().backgroundTotal} 总计</span>
            </ButtonV2>
            <ButtonV2 variant="ghost" class="mafw-rw-overview-card" onClick={() => props.onOpenSection("todos")}>
              <span class="mafw-rw-overview-label">待办</span>
              <strong>{summary().todoDone}/{summary().todoTotal}</strong>
              <span>{summary().waitingForInput > 0 ? `${summary().waitingForInput} 等待输入` : "无等待输入"}</span>
            </ButtonV2>
          </div>

          <Show when={summary().waitingForInput > 0}>
            <div class="mafw-rw-overview-attention">
              <Icon name="status" size="small" />
              <span>{summary().waitingForInput} 个后台任务等待输入</span>
              <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenSection("background")}>查看</ButtonV2>
            </div>
          </Show>

          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-rw-usage-toggle"
            aria-expanded={usageOpen()}
            onClick={() => setUsageOpen((v) => !v)}
          >
            <Icon name="chart" size="small" />
            用量与上下文 {usageOpen() ? "▴" : "▾"}
          </ButtonV2>
          <Show when={usageOpen()}>
            <div class="mafw-rw-usage">{props.usage}</div>
          </Show>
        </div>
      </div>

      <div class="mafw-rw-exec-section" classList={{ "is-active": props.section === "todos" }}>
        <TaskList
          todos={props.todos}
          hiddenTodos={props.hiddenTodos}
          onClearHidden={props.onClearHidden}
          tokens={props.tokens}
          started={props.started}
          placement="dock"
          onClose={props.onClosePanel}
          onPin={() => {}}
        />
      </div>

      <div class="mafw-rw-exec-section" classList={{ "is-active": props.section === "subagents" }}>
        <SubagentDock activeSessionId={props.sessionID} onOpenSession={props.onOpenSubagent} />
      </div>

      <div class="mafw-rw-exec-section" classList={{ "is-active": props.section === "background" }}>
        <BackgroundDock
          activeSessionId={props.sessionID}
          sessionDirectory={props.sessionDirectory}
          onOpenSession={props.onOpenSubagent}
        />
      </div>

      <div class="mafw-rw-exec-section" classList={{ "is-active": props.section === "trajectory" }}>
        <TrajectoryDock
          sessionID={props.sessionID ?? ""}
          liveEvents={props.trajectoryLive}
          liveTurn={props.trajectoryTurnLive}
        />
      </div>
    </div>
  )
}
