/**
 * Pick the window a navigation target (notification click / tray) should go
 * to. Auxiliary windows — the floating notification surface — must never
 * receive navigation: on Windows a click on a `focusable:false` window can
 * still surface as `getFocusedWindow()`, which would swallow the click.
 */
export interface NavigationWindowSelector<W> {
  isFocused(win: W): boolean
  isAuxiliary(win: W): boolean
  isDestroyed(win: W): boolean
  lastFocused(): W | null
}

export function pickNavigationWindow<W>(
  windows: readonly W[],
  selector: NavigationWindowSelector<W>,
): W | null {
  const live = (win: W) => !selector.isDestroyed(win)
  const main = (win: W) => !selector.isAuxiliary(win)

  for (const win of windows) {
    if (live(win) && main(win) && selector.isFocused(win)) return win
  }
  const last = selector.lastFocused()
  if (last && live(last) && main(last)) return last
  for (const win of windows) {
    if (live(win) && main(win)) return win
  }
  return null
}
