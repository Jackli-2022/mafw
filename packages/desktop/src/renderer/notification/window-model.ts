import type { MafwNotification } from "../../shared/notifications"

export type FloatingTheme = "light" | "dark"

/** Payload main pushes to the floating window renderer. */
export interface FloatingPayload {
  items: MafwNotification[]
  theme: FloatingTheme
}

export function applyNotificationTheme(doc: Document, theme: FloatingTheme): void {
  doc.documentElement.dataset.colorScheme = theme
}

/** Card a11y label: title + summary in one string. */
export function notificationCardLabel(item: MafwNotification): string {
  return item.body ? `${item.title} — ${item.body}` : item.title
}
