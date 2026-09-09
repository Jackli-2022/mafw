// @ts-nocheck
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import type { ParentProps } from "solid-js"

export type ContextMenuItem = {
  label: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  onSelect?: () => void
}

type Props = ParentProps<{
  items: ContextMenuItem[]
}>

export function MafwContextMenu(props: Props) {
  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          {props.items.map((item) =>
            item.separator ? (
              <ContextMenu.Separator />
            ) : (
              <ContextMenu.Item
                disabled={item.disabled}
                onSelect={item.onSelect}
                data-danger={item.danger ? "" : undefined}
              >
                <ContextMenu.ItemLabel>{item.label}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            )
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
