import { Show, createEffect } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { Annotation } from "../../../shared/annotation-types"
import { annotationsByIDs, hydrateAnnotationsByIDs } from "../annotation-store"

export function AnnotationMessageRefs(props: {
  ids: readonly string[]
  onProcess: (items: Annotation[]) => void
}) {
  createEffect(() => {
    if (props.ids.length > 0) void hydrateAnnotationsByIDs(props.ids)
  })

  const items = () => annotationsByIDs(props.ids).filter((annotation) => !annotation.delegatedAt)

  return (
    <Show when={items().length > 0}>
      <div class="mafw-annotation-message-refs">
        <span class="mafw-annotation-message-refs-label">批注 {items().length} 条 · 已讨论</span>
        <ButtonV2 variant="ghost" size="small" onClick={() => props.onProcess(items())}>
          处理这些批注
        </ButtonV2>
      </div>
    </Show>
  )
}
