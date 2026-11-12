import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { filterPickerItems, type PickerItem } from "../focus/picker-model"

const KIND_LABELS: Record<PickerItem["kind"], string> = {
  world: "世界",
  file: "文件",
  recent: "最近",
  goal: "Goal",
  change: "变更",
  review: "评审",
  command: "命令",
}

/** 取景器：工作台唯一的导航入口。 */
export function SubjectPicker(props: {
  open: boolean
  items: readonly PickerItem[]
  onClose: () => void
  onPick: (item: PickerItem) => void
}): JSX.Element {
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const filtered = createMemo(() => filterPickerItems(props.items, query()))
  let listRef: HTMLDivElement | undefined

  createEffect(() => {
    if (!props.open) return
    setQuery("")
    setActive(0)
  })

  createEffect(() => {
    const length = filtered().length
    if (active() >= length) setActive(Math.max(0, length - 1))
  })

  createEffect(() => {
    active()
    queueMicrotask(() => {
      listRef?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
    })
  })

  const pick = () => {
    const item = filtered()[active()]
    if (item) props.onPick(item)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(0, filtered().length - 1)))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      pick()
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="mafw-subject-picker"
        role="dialog"
        aria-modal="true"
        aria-label="取景器"
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <div class="mafw-subject-picker-panel">
          <div class="mafw-subject-picker-input">
            <TextInputV2
              value={query()}
              appearance="large"
              autofocus
              leadingIcon={<Icon name="magnifying-glass" size="small" />}
              placeholder="搜索文件、Goal、变更、决定…"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>

          <div class="mafw-subject-picker-list" role="listbox" aria-label="结果" ref={(el) => { listRef = el }}>
            <Show
              when={filtered().length > 0}
              fallback={<div class="mafw-subject-picker-empty">没有匹配的对象</div>}
            >
              <For each={filtered()}>
                {(item, index) => (
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-subject-picker-item"
                    role="option"
                    aria-selected={index() === active()}
                    onClick={() => props.onPick(item)}
                  >
                    <span class="mafw-subject-picker-kind">{KIND_LABELS[item.kind]}</span>
                    <span class="mafw-subject-picker-label">{item.label}</span>
                    <Show when={item.detail}>
                      <span class="mafw-subject-picker-detail">{item.detail}</span>
                    </Show>
                  </ButtonV2>
                )}
              </For>
            </Show>
          </div>

          <div class="mafw-subject-picker-hint">↑↓ 选择 · ↵ 打开 · esc 关闭</div>
        </div>
      </div>
    </Show>
  )
}
