export function retitleTab<T extends { id: string; title: string }>(
  tabs: T[],
  sessionId: string,
  title: string | undefined,
): T[] {
  const next = title?.trim()
  if (!next) return tabs
  let changed = false
  const updated = tabs.map((tab) => {
    if (tab.id !== sessionId || tab.title === next) return tab
    changed = true
    return { ...tab, title: next }
  })
  return changed ? updated : tabs
}
