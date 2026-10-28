export function shouldRestoreFocus(active: { tagName?: string } | null | undefined): boolean {
  return !active || active.tagName === "BODY"
}
