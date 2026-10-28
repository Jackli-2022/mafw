import { For, Show, type ComponentProps, type JSX } from "solid-js"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import { Icon } from "@mafw/ui/icon"
import type { MenuController } from "./controller"
import { toRenderRows, toRenderRowsFromItems, type RenderRow } from "./render-model"
import "./context-menu.css"

type IconName = ComponentProps<typeof Icon>["name"]

export function MenuHost(props: { controller: MenuController }): JSX.Element {
  const request = () => props.controller.current()
  const run = (id: string) => {
    request()?.run(id)
    props.controller.close()
  }

  const row = (entry: RenderRow): JSX.Element => {
    switch (entry.kind) {
      case "separator":
        return <DropdownMenu.Separator />
      case "item":
        return (
          <DropdownMenu.Item
            data-danger={entry.item.danger ? "" : undefined}
            disabled={entry.item.disabled}
            onSelect={() => run(entry.item.id)}
          >
            <Show when={entry.item.icon}>
              <span class="mafw-context-menu-icon">
                <Icon name={entry.item.icon as IconName} size="small" />
              </span>
            </Show>
            <DropdownMenu.ItemLabel>{entry.item.label}</DropdownMenu.ItemLabel>
            <Show when={entry.item.disabled && entry.item.disabledReason}>
              <DropdownMenu.ItemDescription>{entry.item.disabledReason}</DropdownMenu.ItemDescription>
            </Show>
            <Show when={entry.item.shortcut}>
              <span class="mafw-context-menu-shortcut">{entry.item.shortcut}</span>
            </Show>
          </DropdownMenu.Item>
        )
      case "checkbox":
        return (
          <DropdownMenu.Item onSelect={() => run(entry.item.id)}>
            <span class="mafw-context-menu-check">{entry.item.checked ? "✓" : ""}</span>
            <DropdownMenu.ItemLabel>{entry.item.label}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        )
      case "radio":
        return (
          <DropdownMenu.Item onSelect={() => run(entry.item.id)}>
            <span class="mafw-context-menu-check">{entry.item.checked ? "●" : ""}</span>
            <DropdownMenu.ItemLabel>{entry.item.label}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        )
      case "submenu":
        return (
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <Show when={entry.item.icon}>
                <span class="mafw-context-menu-icon">
                  <Icon name={entry.item.icon as IconName} size="small" />
                </span>
              </Show>
              <DropdownMenu.ItemLabel>{entry.item.label}</DropdownMenu.ItemLabel>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent class="mafw-context-menu">
                <For each={toRenderRowsFromItems(entry.item.items)}>{row}</For>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        )
      case "group":
        return (
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel>{entry.item.label}</DropdownMenu.GroupLabel>
            <For each={entry.rows}>{row}</For>
          </DropdownMenu.Group>
        )
    }
  }

  return (
    <DropdownMenu
      open={!!request()}
      onOpenChange={(open) => {
        if (!open) props.controller.close()
      }}
      placement="bottom-start"
      gutter={6}
    >
      <DropdownMenu.Trigger
        as="span"
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "fixed",
          left: `${props.controller.point().x}px`,
          top: `${props.controller.point().y}px`,
          width: "1px",
          height: "1px",
          "pointer-events": "none",
        }}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="mafw-context-menu">
          <For each={toRenderRows(request()?.model)}>{row}</For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
