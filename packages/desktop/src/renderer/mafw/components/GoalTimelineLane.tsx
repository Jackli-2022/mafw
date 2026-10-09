// @ts-nocheck
// 泳道（阶段 × loop）+ 点格子内联明细。纯展示：数据与动作经 props 注入。
import { createSignal, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { formatDuration, cellSummary, artifactRef, type Lane } from "../goal-timeline"

const TONE_CLASS: Record<string, string> = {
  ok: "mafw-cell-ok", running: "mafw-cell-running", fail: "mafw-cell-fail", idle: "mafw-cell-idle",
}
const TONE_ICON: Record<string, string> = { ok: "✓", running: "●", fail: "✗", idle: "—" }

export function GoalTimelineLane(props: {
  goalId: string
  loops: number[]
  lanes: Lane[]
  artifacts?: { wavesPath?: string; reviewsDir?: string; receipts?: string[] }
  onOpenSession: (sid: string) => void
  onRetry: (runId: number, node: string) => void
  retrying: boolean
}) {
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const key = (node: string, loop: number) => `${node}:${loop}`
  const toggle = (node: string, loop: number) =>
    setExpanded((k) => (k === key(node, loop) ? null : key(node, loop)))

  const cellOf = (node: string, loop: number) =>
    props.lanes.find((l) => l.node === node)?.cells.find((c) => c.loop === loop)!

  const copy = (text: string) => { try { navigator.clipboard.writeText(text) } catch { /* ignore */ } }

  return (
    <div class="mafw-lane-wrap">
      <div class="mafw-lane-grid" style={{ "grid-template-columns": `82px repeat(${props.loops.length}, minmax(140px, 1fr))` }}>
        {/* header row */}
        <div class="mafw-lane-corner">阶段 \ Loop</div>
        <For each={props.loops}>
          {(loop) => <div class="mafw-lane-colhead">Loop {loop}</div>}
        </For>

        {/* one lane row per phase + optional inline expansion row */}
        <For each={props.lanes}>
          {(lane) => (
            <>
              <div class="mafw-lane-rowhead">{lane.node.toUpperCase()}</div>
              <For each={props.loops}>
                {(loop) => {
                  const cell = cellOf(lane.node, loop)
                  const latest = cell.latest
                  return (
                    <div class="mafw-lane-cellwrap">
                      <div
                        class={`mafw-lane-cell ${TONE_CLASS[cell.tone]}`}
                        onClick={() => latest && toggle(lane.node, loop)}
                      >
                        <div class="mafw-lane-cell-line1">
                          <span class="mafw-lane-cell-icon">{TONE_ICON[cell.tone]}</span>
                          <span>{latest ? formatDuration(latest.durationMs) : ""}</span>
                          <Show when={cell.attempts.length > 1}>
                            <span class="mafw-lane-attempt-badge">×{cell.attempts.length}</span>
                          </Show>
                          <Show when={expanded() === key(lane.node, loop)}>
                            <span class="mafw-lane-caret">▾</span>
                          </Show>
                        </div>
                        <div class="mafw-lane-cell-line2">{cellSummary(latest)}</div>
                      </div>
                    </div>
                  )
                }}
              </For>

              {/* inline expansion row spans all columns */}
              <Show when={lane.cells.find((c) => expanded() === key(c.node, c.loop))}>
                {(cell) => {
                  const run = () => cell().latest!
                  const art = () => artifactRef(lane.node, props.goalId, cell().loop)
                  return (
                    <div class="mafw-lane-expand" style={{ "grid-column": "1 / -1" }}>
                      <div class="mafw-lane-expand-head">
                        Loop {cell().loop} · {lane.node.toUpperCase()} 明细
                        <Show when={cell().attempts.length > 1}>
                          <span class="mafw-card-meta">（attempt {run().attempt}/{cell().attempts.length}）</span>
                        </Show>
                      </div>
                      <div class="mafw-lane-expand-grid">
                        <div>开始：{run().startedAt ? new Date(run().startedAt).toLocaleTimeString() : "—"}</div>
                        <div>结束：{run().finishedAt ? new Date(run().finishedAt).toLocaleTimeString() : "进行中"}</div>
                        <div>耗时：{formatDuration(run().durationMs)}</div>
                        <div>Token：in {run().tokensInput ?? "—"} / out {run().tokensOutput ?? "—"}</div>
                        <div>结果：{run().outcome ?? run().status}</div>
                        <div>成本：{run().costUsd != null ? `$${run().costUsd.toFixed(2)}` : "—"}</div>
                      </div>
                      <Show when={run().error}>
                        <div class="mafw-lane-expand-error">{run().error}</div>
                      </Show>
                      <Show when={lane.node === "review" && run().outcome && run().outcome !== "PASS"}>
                        <div class="mafw-lane-expand-error">feedback 见评审报告</div>
                      </Show>
                      <div class="mafw-lane-expand-actions">
                        <Show when={run().sessionId}>
                          <ButtonV2 variant="neutral" size="small" onClick={() => props.onOpenSession(run().sessionId)}>打开会话</ButtonV2>
                        </Show>
                        <Show when={art()}>
                          <TooltipV2 value={art()!.ref}>
                            <ButtonV2 variant="neutral" size="small" onClick={() => copy(art()!.ref)}>{art()!.label}</ButtonV2>
                          </TooltipV2>
                        </Show>
                        <Show when={["failed", "timeout", "aborted"].includes(run().status)}>
                          <ButtonV2
                            variant="contrast" size="small" disabled={props.retrying}
                            onClick={() => props.onRetry(run().runId, lane.node)}
                          >重跑此节点</ButtonV2>
                        </Show>
                        <Show when={lane.node === "execute"}>
                          <span class="mafw-card-meta">（execute 重跑需二次确认）</span>
                        </Show>
                      </div>
                    </div>
                  )
                }}
              </Show>
            </>
          )}
        </For>
      </div>

      <div class="mafw-goal-artifacts">
        <Show when={props.artifacts?.wavesPath}>
          <TooltipV2 value={props.artifacts!.wavesPath!}>
            <span class="mafw-artifact-chip" onClick={() => copy(props.artifacts!.wavesPath!)}>waves.json</span>
          </TooltipV2>
        </Show>
        <Show when={props.artifacts?.reviewsDir}>
          <TooltipV2 value={props.artifacts!.reviewsDir!}>
            <span class="mafw-artifact-chip" onClick={() => copy(props.artifacts!.reviewsDir!)}>reviews/</span>
          </TooltipV2>
        </Show>
      </div>
    </div>
  )
}
