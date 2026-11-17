import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { MafwNotification } from "../../../shared/notifications"
import {
  filterNotifications,
  formatNotificationTime,
  notificationKindIcon,
  notificationReasonLabel,
  type NotificationFilter,
} from "../notifications/notification-view-model"
import {
  clearNotificationRead,
  markAllNotificationsRead,
  notificationState,
} from "../notifications/notification-store"
import "./notification-center.css"

export function NotificationCenter(props: {
  open: boolean
  onClose(): void
  onOpen(item: MafwNotification): void
}) {
  const [filter, setFilter] = createSignal<NotificationFilter>("all")
  const [active, setActive] = createSignal(0)
  const [now, setNow] = createSignal(Date.now())
  let panel: HTMLElement | undefined

  const filtered = createMemo(() => filterNotifications(notificationState.items, filter()))
  const unread = () => notificationState.unread
  const hasRead = createMemo(() => notificationState.items.some((item) => item.readAt !== undefined))

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (!props.open) return
    setActive(0)
    queueMicrotask(() => panel?.focus())
  })

  createEffect(() => {
    filter()
    setActive(0)
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const list = filtered()
      if (list.length === 0) return
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      const next = (active() + step + list.length) % list.length
      setActive(next)
      // 焦点跟随高亮：Enter/屏幕阅读器作用在可见焦点元素上，二者不得分叉。
      queueMicrotask(() => {
        const el = panel?.querySelector<HTMLElement>(`.mafw-notification-card[data-index="${next}"]`)
        el?.focus()
      })
      return
    }
    if (event.key === "Enter") {
      const item = filtered()[active()]
      if (!item) return
      event.preventDefault()
      props.onOpen(item)
    }
  }

  return (
    <Show when={props.open}>
      <div class="mafw-notification-backdrop" onPointerDown={props.onClose} />
      <section
        class="mafw-notification-panel"
        role="dialog"
        aria-label="通知"
        tabIndex={-1}
        ref={(el) => { panel = el }}
        onKeyDown={onKeyDown}
      >
        <header class="mafw-notification-head">
          <div class="mafw-notification-heading">
            <Icon name="bell" size="small" />
            <span>通知</span>
            <Show when={unread() > 0}>
              <span class="mafw-notification-count">{unread()}</span>
            </Show>
          </div>
          <div class="mafw-notification-head-actions">
            <ButtonV2
              variant="ghost"
              size="small"
              disabled={unread() === 0}
              onClick={() => { void markAllNotificationsRead() }}
            >
              全部已读
            </ButtonV2>
            <ButtonV2 variant="ghost" size="small" icon="close" aria-label="关闭通知" onClick={props.onClose} />
          </div>
        </header>

        <div class="mafw-notification-filters" role="tablist" aria-label="通知筛选">
          <ButtonV2
            variant="ghost"
            size="small"
            aria-pressed={filter() === "all"}
            onClick={() => setFilter("all")}
          >
            全部
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-pressed={filter() === "unread"}
            onClick={() => setFilter("unread")}
          >
            未读
          </ButtonV2>
        </div>

        <div class="mafw-notification-list">
          <Show
            when={filtered().length > 0}
            fallback={<div class="mafw-notification-empty">暂无通知</div>}
          >
            <For each={filtered()}>
              {(item, index) => (
                <div
                  class="mafw-notification-card"
                  classList={{ unread: item.readAt === undefined, active: active() === index() }}
                  role="button"
                  tabIndex={0}
                  data-index={index()}
                  aria-label={`${item.title}，${notificationReasonLabel(item)}`}
                  onClick={() => props.onOpen(item)}
                  onPointerEnter={() => setActive(index())}
                >
                  <div class="mafw-notification-card-icon">
                    <Icon name={notificationKindIcon(item.kind)} size="small" />
                  </div>
                  <div class="mafw-notification-card-content">
                    <div class="mafw-notification-card-title">{item.title}</div>
                    <Show when={item.body}>
                      <div class="mafw-notification-card-text">{item.body}</div>
                    </Show>
                    <div class="mafw-notification-card-meta">
                      <span>{notificationReasonLabel(item)}</span>
                      <span>{formatNotificationTime(now(), item.createdAt)}</span>
                    </div>
                  </div>
                  <Show when={item.readAt === undefined}>
                    <span class="mafw-notification-dot" aria-hidden="true" />
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>

        <Show when={hasRead()}>
          <footer class="mafw-notification-foot">
            <ButtonV2
              variant="ghost"
              size="small"
              onClick={() => { void clearNotificationRead() }}
            >
              清空已读
            </ButtonV2>
          </footer>
        </Show>
      </section>
    </Show>
  )
}
