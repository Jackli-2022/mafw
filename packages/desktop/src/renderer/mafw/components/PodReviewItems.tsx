// Goal result review items (Plan C): unresolved opinions first, human-only actions.
import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PodReviewItem } from "@mafw/sdk"
import {
  canReopenReviewItem,
  canResolveReviewItem,
  orderReviewItems,
  reviewCounts,
  reviewStatusLabel,
} from "../pod-review-model"

export function PodReviewItems(props: {
  items: readonly PodReviewItem[]
  busy: boolean
  accepted: boolean
  onResolve(item: PodReviewItem): void
  onReopen(item: PodReviewItem): void
}) {
  const ordered = () => orderReviewItems(props.items)
  const counts = () => reviewCounts(props.items)
  const where = (item: PodReviewItem): string => {
    if (item.startLine == null) return item.rel
    if (item.endLine == null || item.endLine === item.startLine) return `${item.rel}:L${item.startLine}`
    return `${item.rel}:L${item.startLine}-${item.endLine}`
  }

  return (
    <section class="mafw-pod-review" aria-label="评审意见">
      <div class="mafw-pod-review-head">
        <span class="mafw-pod-review-title">评审意见</span>
        <span class="mafw-pod-review-count">
          未解决 {counts().unresolved}
          <Show when={counts().resolved > 0}> · 已解决 {counts().resolved}</Show>
        </span>
      </div>

      <Show when={ordered().length === 0}>
        <div class="mafw-pod-review-empty">还没有评审意见。</div>
      </Show>

      <For each={ordered()}>
        {(item) => (
          <article class="mafw-pod-review-item" data-status={item.status}>
            <div class="mafw-pod-review-item-head">
              <span class="mafw-pod-review-status">{reviewStatusLabel(item.status)}</span>
              <span class="mafw-pod-review-where">{where(item)}</span>
              <Show when={item.originRevision != null}>
                <span class="mafw-pod-review-origin">来自 revision {item.originRevision}</span>
              </Show>
            </div>
            <div class="mafw-pod-review-comment">{item.comment}</div>
            <Show when={item.response}>
              <div class="mafw-pod-review-response">
                <span class="mafw-pod-review-response-label">Tech Lead 回应</span>
                <span>{item.response}</span>
              </div>
            </Show>
            <Show when={!props.accepted && (canResolveReviewItem(item) || canReopenReviewItem(item))}>
              <div class="mafw-pod-review-actions">
                <Show when={canResolveReviewItem(item)}>
                  <ButtonV2
                    variant="outline"
                    size="small"
                    disabled={props.busy}
                    onClick={() => props.onResolve(item)}
                  >
                    确认解决
                  </ButtonV2>
                </Show>
                <Show when={canReopenReviewItem(item)}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={props.busy}
                    onClick={() => props.onReopen(item)}
                  >
                    重新打开
                  </ButtonV2>
                </Show>
              </div>
            </Show>
          </article>
        )}
      </For>
    </section>
  )
}
