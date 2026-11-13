// 右 dock 的共享文档框架：tab 条、toolbar、内容 body 只有一套度量。
// 编辑器与浏览器各自提供 tab 数据和动作，不再各自发明 header / pill tab / 地址栏。
import { For, Show, type JSX } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { openMenuOnKey } from "../context-menu/menu-key"
import { tabStripWheelDelta, type DocumentTabView } from "../document-frame-model"

export function DocumentFrame(props: {
  tabs?: JSX.Element
  toolbar?: JSX.Element
  children: JSX.Element
  onContextMenu?: (event: MouseEvent) => void
}): JSX.Element {
  return (
    <div class="mafw-document-frame" onContextMenu={props.onContextMenu}>
      {props.tabs}
      {props.toolbar}
      <div class="mafw-document-body">{props.children}</div>
    </div>
  )
}

export function DocumentTabs(props: {
  items: readonly DocumentTabView[]
  ariaLabel: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onMiddleClick?: (id: string) => void
  onContextMenu?: (id: string, event: MouseEvent) => void
  trailing?: JSX.Element
}): JSX.Element {
  const close = (id: string) => props.onClose(id)
  let stripEl: HTMLDivElement | undefined
  const onWheel = (event: WheelEvent) => {
    const el = stripEl
    if (!el || el.scrollWidth <= el.clientWidth) return
    const delta = tabStripWheelDelta(event, el.clientWidth)
    if (!delta) return
    event.preventDefault()
    el.scrollLeft += delta
  }
  return (
    <div
      ref={(el) => { stripEl = el }}
      class="mafw-document-tabs"
      role="tablist"
      aria-label={props.ariaLabel}
      onWheel={onWheel}
    >
      <For each={props.items}>
        {(item) => (
          <div
            class="mafw-document-tab"
            classList={{
              "is-active": item.active,
              "mafw-document-tab-preview": item.preview === true,
            }}
            role="tab"
            tabIndex={0}
            aria-selected={item.active}
            aria-label={item.title ?? item.label}
            onClick={() => props.onSelect(item.id)}
            onContextMenu={(event) => {
              props.onContextMenu?.(item.id, event)
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return
              event.preventDefault()
              ;(props.onMiddleClick ?? close)(item.id)
            }}
            onKeyDown={(event) => {
              openMenuOnKey(event)
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              props.onSelect(item.id)
            }}
          >
            <span class="mafw-document-tab-icon"><Icon name={item.icon} size="small" /></span>
            <span class="mafw-document-tab-label">{item.label}</span>
            <Show when={item.dirty}>
              <span class="mafw-document-tab-dot" aria-label="未保存" />
            </Show>
            <Show when={item.readOnly}>
              <span class="mafw-document-tab-ro">只读</span>
            </Show>
            <span
              class="mafw-document-tab-close"
              role="button"
              tabIndex={0}
              aria-label="关闭"
              onClick={(event) => {
                event.stopPropagation()
                close(item.id)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                event.stopPropagation()
                close(item.id)
              }}
            >
              <Icon name="close-small" size="small" />
            </span>
          </div>
        )}
      </For>
      <Show when={props.trailing}>
        <div class="mafw-document-tabs-trailing">{props.trailing}</div>
      </Show>
    </div>
  )
}

export function DocumentToolbar(props: {
  ariaLabel: string
  leading?: JSX.Element
  center?: JSX.Element
  trailing?: JSX.Element
}): JSX.Element {
  return (
    <div class="mafw-document-toolbar" role="toolbar" aria-label={props.ariaLabel}>
      <Show when={props.leading}>
        <div class="mafw-document-toolbar-group">{props.leading}</div>
      </Show>
      <Show when={props.center}>
        <div class="mafw-document-toolbar-center">{props.center}</div>
      </Show>
      <Show when={props.trailing}>
        <div class="mafw-document-toolbar-group mafw-document-toolbar-trailing">{props.trailing}</div>
      </Show>
    </div>
  )
}
