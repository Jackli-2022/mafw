// ApprovalSummaryLine：一回合的审批卡汇总为一行（v6 追加需求）。
// 卡片组件与交互逻辑不改——折叠时只显示一行摘要，展开时原样渲染传入的卡片。
import { createMemo, createSignal, For, Show } from "solid-js"
import { summarizeApprovals, type ApprovalCardLike } from "./approval-summary"

export function ApprovalSummaryLine(props: {
  cards: ApprovalCardLike[]
  renderCard: (card: any) => any
}) {
  const summary = createMemo(() => summarizeApprovals(props.cards))
  const [userOpen, setUserOpen] = createSignal<boolean | null>(null)
  // 有 pending 时默认展开（它是操作点）；用户点击后以用户选择为准。
  const expanded = () => userOpen() ?? summary()?.hasPending ?? false

  return (
    <Show when={summary()}>
      <div class="mafw-approval-summary">
        <div
          class="mafw-tool-summary-line mafw-approval-summary-line"
          role="button"
          tabIndex={0}
          aria-expanded={expanded() ? "true" : "false"}
          onClick={() => setUserOpen(!expanded())}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setUserOpen(!expanded()) } }}
        >
          <span class="mafw-tool-summary-text">{summary()!.text}</span>
          <span class="mafw-approval-caret" aria-hidden="true">{expanded() ? "▾" : "▸"}</span>
        </div>
        <Show when={expanded()}>
          <div class="mafw-approval-cards">
            <For each={props.cards}>{(c) => props.renderCard(c)}</For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
