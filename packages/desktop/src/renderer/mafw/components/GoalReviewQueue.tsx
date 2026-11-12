import { Show, createEffect, createSignal, type JSX } from "solid-js"
import type { PodReviewItem } from "@mafw/sdk"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { PodReviewItems } from "./PodReviewItems"

/** Goal 评审队列：数据来自 pod.reviewItems，状态权威仍在 gateway。 */
export function GoalReviewQueue(props: {
  podId: string
  goalId: string
  revision: number
  accepted: boolean
  refreshKey?: () => unknown
  onFocusItem: (item: PodReviewItem) => void
  onResolved?: () => void
}): JSX.Element {
  const [items, setItems] = createSignal<PodReviewItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let requestSeq = 0

  const refresh = async () => {
    const seq = ++requestSeq
    try {
      const listed = await window.api.mafw.pod.reviewItems(props.podId, props.goalId, {
        revision: props.revision,
      })
      if (seq !== requestSeq) return
      setItems(Array.isArray(listed?.items) ? listed.items : [])
      setError(null)
    } catch (err: any) {
      if (seq !== requestSeq) return
      setError(String(err?.message ?? err).slice(0, 160))
    }
  }

  createEffect(() => {
    props.podId
    props.goalId
    props.revision
    void props.refreshKey?.()
    void refresh()
  })

  const resolve = async (item: PodReviewItem) => {
    if (busy()) return
    setBusy(true)
    try {
      await window.api.mafw.pod.resolveReviewItem(props.podId, props.goalId, item.id)
      await refresh()
      props.onResolved?.()
    } catch (err: any) {
      showToastV2({
        description: `确认解决失败：${String(err?.message ?? err).slice(0, 120)}`,
        duration: 3200,
      })
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  const reopen = async (item: PodReviewItem) => {
    if (busy()) return
    setBusy(true)
    try {
      await window.api.mafw.pod.reopenReviewItem(props.podId, props.goalId, item.id)
      await refresh()
      props.onResolved?.()
    } catch (err: any) {
      showToastV2({
        description: `重新打开失败：${String(err?.message ?? err).slice(0, 120)}`,
        duration: 3200,
      })
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="mafw-goal-review-queue">
      <Show
        when={error() && items().length === 0}
        fallback={
          <PodReviewItems
            items={items()}
            busy={busy()}
            accepted={props.accepted}
            onResolve={(item) => { void resolve(item) }}
            onReopen={(item) => { void reopen(item) }}
            onFocus={props.onFocusItem}
          />
        }
      >
        <div class="mafw-empty">
          <div>评审意见加载失败</div>
          <ButtonV2 variant="ghost" size="small" onClick={() => void refresh()}>
            重试
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}
