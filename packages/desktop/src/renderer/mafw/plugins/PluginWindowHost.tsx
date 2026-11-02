// Task 11: host for declarative plugin message windows.
//
// Mounted once at the application root, inside the MAFW document. It routes
// registered package events to declarations, keeps one window per
// `<package>:<declaration.id>`, applies committed descriptor revisions, and
// owns modal focus (trap + restore). It never creates a BrowserWindow, never
// changes OS window state and never executes plugin code.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { pluginDescriptors, subscribePluginEvent } from "./plugin-store"
import {
  EMPTY_PLUGIN_WINDOW_STATE,
  applyWindowRevision,
  closePluginWindow,
  cycleFocusIndex,
  openPluginWindow,
  pluginWindowDeclarations,
  pluginWindowTriggersOn,
  type PluginWindowEntry,
  type PluginWindowEventPayload,
  type PluginWindowState,
} from "./plugin-windows"
import { PluginMessageWindow } from "./PluginMessageWindow"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function PluginWindowHost() {
  const [state, setState] = createSignal<PluginWindowState>(EMPTY_PLUGIN_WINDOW_STATE)
  const keys = createMemo(() => state().windows.map((entry) => entry.key))
  const entryOf = (key: string): PluginWindowEntry | null =>
    state().windows.find((entry) => entry.key === key) ?? null
  const modelessEntry = (key: string) => {
    const entry = entryOf(key)
    return entry && !entry.modal ? entry : null
  }
  const modalEntry = (key: string) => {
    const entry = entryOf(key)
    return entry && entry.modal ? entry : null
  }

  const elements = new Map<string, HTMLElement>()
  const register = (key: string, element: HTMLElement | null) => {
    if (element) {
      elements.set(key, element)
      return
    }
    // A modal/modeless flip mounts the replacement before the old slot is
    // disposed; keep the connected replacement instead of deleting it.
    const current = elements.get(key)
    if (!current || !current.isConnected) elements.delete(key)
  }

  // Committed descriptors drive cleanup/update of open windows. Unchanged
  // windows keep their entry object, so ordinary revisions do not churn them.
  createEffect(() => {
    const descriptors = pluginDescriptors()
    setState((previous) => applyWindowRevision(previous, descriptors))
  })

  // Subscribe to each declaration's exact trigger. The store already filters
  // unregistered/foreign events; this layer re-checks the exact type so an
  // unrelated registered event of the same package never opens a window.
  createEffect(() => {
    const descriptors = pluginDescriptors()
    const unsubscribes: Array<() => void> = []
    for (const descriptor of descriptors) {
      for (const declaration of pluginWindowDeclarations(descriptor)) {
        unsubscribes.push(
          subscribePluginEvent(declaration.triggerEvent, (notice) => {
            if (!pluginWindowTriggersOn(declaration, descriptor.name, notice.type)) return
            const event: PluginWindowEventPayload = {
              type: notice.type,
              properties: notice.properties,
              sessionID: notice.sessionID,
            }
            setState((previous) =>
              openPluginWindow(previous, { descriptor, declaration, event }),
            )
          }),
        )
      }
    }
    onCleanup(() => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    })
  })

  // Modal focus ownership: capture the previously focused element when focus
  // enters a modal, move it into the topmost modal, and restore it when the
  // last modal closes. Modeless windows never reach this path.
  let restoreElement: HTMLElement | null = null
  let lastModalKey: string | null = null
  let lastFocusToken = -1
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  createEffect(() => {
    const focus = state().focus
    if (focus.token === lastFocusToken) return
    lastFocusToken = focus.token
    const modalKey = focus.modalKey

    if (modalKey && !lastModalKey) {
      restoreElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    if (!modalKey && lastModalKey) {
      const target = restoreElement
      restoreElement = null
      if (target && target.isConnected) queueMicrotask(() => target.focus())
    }
    lastModalKey = modalKey
    if (!modalKey) return

    queueMicrotask(() => {
      if (disposed || state().focus.modalKey !== modalKey) return
      const root = elements.get(modalKey)
      if (root) focusFirst(root)
    })
  })

  const topModalKey = () => state().focus.modalKey

  const requestClose = (key: string) => {
    const entry = entryOf(key)
    if (!entry || !entry.dismissible) return
    setState((previous) => closePluginWindow(previous, key))
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      const modalKey = state().focus.modalKey
      if (!modalKey) return
      const entry = entryOf(modalKey)
      if (!entry) return

      if (event.key === "Escape") {
        // A modal is blocking: Esc never leaks to the workspace beneath it,
        // and only a dismissible window actually closes.
        event.preventDefault()
        event.stopPropagation()
        if (entry.dismissible) setState((previous) => closePluginWindow(previous, modalKey))
        return
      }

      if (event.key !== "Tab") return
      const root = elements.get(modalKey)
      if (!root) return
      const focusables = focusableElements(root)
      if (focusables.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const current = focusables.indexOf(document.activeElement as HTMLElement)
      const next = cycleFocusIndex(current, focusables.length, event.shiftKey)
      event.preventDefault()
      const target = focusables[next]
      if (target) target.focus()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <>
      {/* Modeless: floating, non-blocking, never steals focus. */}
      <div class="mafw-plugin-windows" aria-live="polite">
        <For each={keys()}>
          {(key) => (
            <Show when={modelessEntry(key)}>
              {(entry) => (
                <PluginMessageWindow
                  entry={entry()}
                  topModal={false}
                  onClose={() => requestClose(key)}
                  onRegister={(element) => register(key, element)}
                />
              )}
            </Show>
          )}
        </For>
      </div>

      {/* Modal: centered overlay with a focus trap; dismissible closes on Esc. */}
      <For each={keys()}>
        {(key) => (
          <Show when={modalEntry(key)}>
            {(entry) => (
              <div
                class="mafw-plugin-window-backdrop"
                classList={{ "is-under": topModalKey() !== key }}
                style={{ "z-index": 240 + Math.max(0, keys().indexOf(key)) }}
                onClick={(event) => {
                  if (event.target !== event.currentTarget) return
                  requestClose(key)
                }}
              >
                <PluginMessageWindow
                  entry={entry()}
                  topModal={topModalKey() === key}
                  onClose={() => requestClose(key)}
                  onRegister={(element) => register(key, element)}
                />
              </div>
            )}
          </Show>
        )}
      </For>
    </>
  )
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && isVisible(element),
  )
}

function focusFirst(root: HTMLElement): void {
  const target = focusableElements(root)[0] ?? root
  target.focus()
}

function isVisible(element: HTMLElement): boolean {
  return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
}
