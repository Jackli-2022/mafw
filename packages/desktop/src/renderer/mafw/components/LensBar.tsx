import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { Lens } from "../focus/focus-model"

const LENS_LABELS: Record<Lens, string> = {
  orient: "总览",
  read: "阅读",
  edit: "修改",
  changes: "变更",
  evidence: "证据",
  review: "审阅",
  decide: "决定",
  interact: "操作",
}

/** 工作台的「镜」：问题不是位置；换镜不换台。 */
export function LensBar(props: {
  lenses: readonly Lens[]
  active: Lens
  counts?: Partial<Record<Lens, number>>
  onLens: (lens: Lens) => void
}): JSX.Element {
  return (
    <div class="mafw-lens-bar">
      <For each={props.lenses}>
        {(lens) => {
          const count = () => props.counts?.[lens]
          return (
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-lens-btn"
              aria-pressed={props.active === lens}
              onClick={() => props.onLens(lens)}
            >
              {LENS_LABELS[lens]}
              <Show when={(count() ?? 0) > 0}>
                <span class="mafw-lens-count">{count()}</span>
              </Show>
            </ButtonV2>
          )
        }}
      </For>

      <span class="mafw-lens-spacer" />
    </div>
  )
}
