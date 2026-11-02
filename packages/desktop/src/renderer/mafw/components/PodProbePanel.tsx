// Task 20：Spike / Probe 报告卡（证据优先；未验证假设显式列出）。
//
// 数据源：SDK `PodProbe`（request + report + scheduling state）。卡片只读——
// 高风险 Spike 的审批仍走既有 approval 面，不在这里另造审批按钮。
import { For, Show } from "solid-js"
import type { PodProbe, PodProbeConclusion, PodProbeStatus } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

const STATUS_LABEL: Record<PodProbeStatus, string> = {
  queued: "排队中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
}

const CONCLUSION_LABEL: Record<PodProbeConclusion, string> = {
  supports: "支持假设",
  refutes: "否定假设",
  inconclusive: "尚不能判断",
}

export function probeStatusLabel(status: PodProbeStatus | string): string {
  return STATUS_LABEL[status as PodProbeStatus] ?? String(status)
}

/** 卡片徽标：有报告用结论，无报告用调度状态；完全未知 → 未知。 */
export function probeBadge(
  input: { conclusion?: PodProbeConclusion | string | null; status?: PodProbeStatus | string | null; report?: { conclusion?: string | null } | null } | null | undefined,
): string {
  if (!input) return "未知"
  const conclusion = input.conclusion ?? input.report?.conclusion ?? null
  if (conclusion) return CONCLUSION_LABEL[conclusion as PodProbeConclusion] ?? String(conclusion)
  if (input.status) return probeStatusLabel(input.status)
  return "未知"
}

/** 卡片标题：优先 Spike 问题，缺失回落 probe id。 */
export function probeCardTitle(probe: Pick<PodProbe, "id"> & { request?: { question?: string | null } | null }): string {
  const question = typeof probe.request?.question === "string" ? probe.request.question.trim() : ""
  return question || `Probe ${probe.id}`
}

function impactText(report: { impact?: { plan?: string | null; goalEval?: string | null } | null } | null | undefined): string {
  if (!report?.impact) return ""
  const bits: string[] = []
  const plan = typeof report.impact.plan === "string" ? report.impact.plan.trim() : ""
  const evalImpact = typeof report.impact.goalEval === "string" ? report.impact.goalEval.trim() : ""
  if (plan) bits.push(`Plan：${plan}`)
  if (evalImpact) bits.push(`Goal Eval：${evalImpact}`)
  return bits.join(" · ")
}

function listText(items: string[] | null | undefined, sep = "；"): string {
  return Array.isArray(items) ? items.filter((item) => typeof item === "string" && item.trim()).join(sep) : ""
}

export function PodProbePanel(props: {
  probes: PodProbe[]
  revision?: number | null
  busy?: boolean
  onOpenPlan?: () => void
}) {
  const visible = () => props.probes ?? []
  return (
    <div class="mafw-card mafw-pod-probes">
      <div class="mafw-pod-section-head">
        <span>Spike / Probe</span>
        <span class="mafw-pod-section-count">{visible().length}</span>
        <Show when={props.revision != null}>
          <span class="mafw-card-meta">revision {props.revision}</span>
        </Show>
        <Show when={props.onOpenPlan}>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPlan?.()}>查看计划</ButtonV2>
        </Show>
      </div>
      <Show when={visible().length > 0} fallback={<div class="mafw-pod-empty-line">还没有 Spike 记录</div>}>
        <For each={visible()}>
          {(probe) => {
            const report = () => probe.report ?? null
            const remaining = () => listText(report()?.remainingAssumptions)
            const impact = () => impactText(report())
            return (
              <div class="mafw-tool-box mafw-pod-probe-card" data-status={probe.status}>
                <div class="mafw-pod-probe-head">
                  <span class="mafw-pod-probe-title">{probeCardTitle(probe)}</span>
                  <span class={`mafw-pod-probe-badge is-${report()?.conclusion ?? probe.status}`}>
                    {probeBadge({ conclusion: report()?.conclusion, status: probe.status })}
                  </span>
                </div>
                <Show when={probe.request?.hypothesis}>
                  <div class="mafw-card-meta">假设：{probe.request.hypothesis}</div>
                </Show>
                <Show when={report()?.keyOutput}>
                  <div class="mafw-pod-probe-output">{report()!.keyOutput}</div>
                </Show>
                <Show when={listText(report()?.commands)}>
                  <div class="mafw-card-meta">命令：{listText(report()?.commands)}</div>
                </Show>
                <Show when={listText(report()?.repro)}>
                  <div class="mafw-card-meta">复现：{listText(report()?.repro)}</div>
                </Show>
                <Show when={remaining()}>
                  <div class="mafw-card-meta">剩余假设：{remaining()}</div>
                </Show>
                <Show when={impact()}>
                  <div class="mafw-card-meta">影响：{impact()}</div>
                </Show>
                <Show when={probe.error}>
                  <div class="mafw-pod-probe-error">{probe.error}</div>
                </Show>
              </div>
            )
          }}
        </For>
      </Show>
    </div>
  )
}
