import { createSignal } from "solid-js"

/**
 * Reactive registry for webviews held by BrowserDock. The Map itself is not
 * reactive; `get()` depends on an epoch signal so toolbar state re-evaluates
 * when a view is created or removed (e.g. after dock collapse/remount).
 */
export function createBrowserViewRegistry<V>() {
  const views = new Map<string, V>()
  const [epoch, setEpoch] = createSignal(0)
  const bump = () => setEpoch((value) => value + 1)
  return {
    get(id: string): V | null {
      epoch()
      return views.get(id) ?? null
    },
    set(id: string, view: V): void {
      views.set(id, view)
      bump()
    },
    delete(id: string): void {
      if (views.delete(id)) bump()
    },
    keys(): string[] {
      return [...views.keys()]
    },
  }
}

/** Explicit navigation must drive an existing view even when the URL is unchanged. */
export function navigateExistingView(
  view: { loadURL?: (url: string) => void } | null,
  url: string,
): boolean {
  if (!view?.loadURL) return false
  try {
    view.loadURL(url)
    return true
  } catch {
    return false
  }
}
