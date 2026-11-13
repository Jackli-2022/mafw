// 右 dock 的共享文档框架：tab 条、toolbar、内容 body 只有一套度量。
// 编辑器与浏览器各自提供 tab 数据和动作，不再各自发明 header / pill tab / 地址栏。
import { For, Show, createSignal, type JSX } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { openMenuOnKey } from "../context-menu/menu-key"
import { documentTabIconName, tabStripWheelDelta, type DocumentTabView } from "../document-frame-model"
import type { DocumentDropPosition } from "../documents/document-tabs-model"

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
  onReorder?: (fromId: string, toId: string, position: DocumentDropPosition) => void
  trailing?: JSX.Element
}): JSX.Element {
  const close = (id: string) => props.onClose(id)
  const [draggingId, setDraggingId] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<{ id: string; position: DocumentDropPosition } | null>(null)
  const canReorder = () => !!props.onReorder
  const clearDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }
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
              "is-dragging": draggingId() === item.id,
              "drop-before": dropTarget()?.id === item.id && dropTarget()?.position === "before",
              "drop-after": dropTarget()?.id === item.id && dropTarget()?.position === "after",
            }}
            role="tab"
            tabIndex={0}
            draggable={canReorder() ? "true" : "false"}
            aria-selected={item.active}
            aria-label={item.title ?? item.label}
            onClick={() => props.onSelect(item.id)}
            onDragStart={(event) => {
              if (!canReorder()) return
              setDraggingId(item.id)
              if (event.dataTransfer) {
                event.dataTransfer.setData("text/plain", item.id)
                event.dataTransfer.effectAllowed = "move"
              }
            }}
            onDragOver={(event) => {
              if (!canReorder() || !draggingId()) return
              event.preventDefault()
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
              const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
              const position: DocumentDropPosition =
                event.clientX < rect.left + rect.width / 2 ? "before" : "after"
              setDropTarget({ id: item.id, position })
            }}
            onDragLeave={() => {
              if (dropTarget()?.id === item.id) setDropTarget(null)
            }}
            onDrop={(event) => {
              if (!canReorder()) return
              event.preventDefault()
              const fromId = draggingId() ?? event.dataTransfer?.getData("text/plain") ?? ""
              const target = dropTarget()
              clearDrag()
              if (!fromId || fromId === item.id) return
              props.onReorder!(fromId, item.id, target?.id === item.id ? target.position : "before")
            }}
            onDragEnd={clearDrag}
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
            <span class="mafw-document-tab-icon"><Icon name={documentTabIconName(item.icon)} size="small" /></span>
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
