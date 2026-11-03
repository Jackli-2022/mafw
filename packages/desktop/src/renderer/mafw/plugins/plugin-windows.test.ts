// Task 11: main-window message windows.
//
// Everything here is plain data in / plain data out: no Solid, no DOM and no
// plugin code. The renderer consumes these helpers so singleton identity,
// trigger routing, modal focus ownership, revision cleanup and stale-response
// guards stay testable without a browser.
import { describe, expect, test } from "bun:test"
import type {
  PluginClientDescriptor,
  PluginMessageWindowDescriptor,
  PluginView,
} from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"
import {
  EMPTY_PLUGIN_WINDOW_STATE,
  EMPTY_PLUGIN_WINDOW_VIEW_STATE,
  applyWindowRevision,
  beginWindowViewRequest,
  closePluginWindow,
  cycleFocusIndex,
  decidePluginWindowDismiss,
  decidePluginWindowEscape,
  failWindowView,
  fetchPluginWindowView,
  openPluginWindow,
  planPluginWindowFocus,
  pluginWindowActionInput,
  pluginWindowDeclarations,
  pluginWindowIdentity,
  pluginWindowKey,
  pluginWindowTriggersOn,
  replaceWindowView,
  settleWindowView,
  setWindowActionOutput,
  shouldShowPluginWindowClose,
  type PluginWindowEventPayload,
  type PluginWindowState,
} from "./plugin-windows"

const event = (type = "plugin:acme:changed", properties: unknown = { value: 1 }): PluginWindowEventPayload => ({
  type,
  properties,
})

function declaration(
  overrides: Partial<PluginMessageWindowDescriptor> = {},
): PluginMessageWindowDescriptor {
  return {
    id: "notice",
    title: "Notice",
    triggerEvent: "plugin:acme:changed",
    viewAction: "open",
    ...overrides,
  }
}

function descriptor(
  overrides: Partial<PluginClientDescriptor> = {},
  windows: PluginMessageWindowDescriptor[] = [declaration()],
): PluginClientDescriptor {
  return {
    name: "acme",
    version: "1.0.0",
    revision: "acme@1",
    ui: { messageWindows: windows },
    actions: [{ name: "open" }, { name: "act" }],
    events: [{ type: "plugin:acme:changed" }, { type: "plugin:acme:other" }],
    ...overrides,
  }
}

function open(
  state: PluginWindowState,
  overrides: {
    descriptor?: PluginClientDescriptor
    declaration?: PluginMessageWindowDescriptor
    event?: PluginWindowEventPayload
    key?: string
  } = {},
): PluginWindowState {
  const decl = overrides.declaration ?? declaration()
  return openPluginWindow(state, {
    key: overrides.key,
    descriptor: overrides.descriptor ?? descriptor({}, [decl]),
    declaration: decl,
    event: overrides.event ?? event(),
  })
}

const view: PluginView = { title: "View", body: [{ type: "text", text: "hello" }] }

const generation = (revision: string): PluginGeneration => {
  const separator = revision.lastIndexOf(":")
  return {
    bootId: separator > 0 ? revision.slice(0, separator) : revision,
    counter: separator > 0 ? Number(revision.slice(separator + 1)) : 0,
    revision,
  }
}

describe("plugin window identity and declarations", () => {
  test("window key is <package>:<declaration.id>", () => {
    expect(pluginWindowKey("acme", "notice")).toBe("acme:notice")
  })

  test("declarations require a declared view action and a registered trigger event", () => {
    const valid = descriptor()
    expect(pluginWindowDeclarations(valid).map((entry) => entry.id)).toEqual(["notice"])

    const missingAction = descriptor(
      { actions: [{ name: "act" }] },
      [declaration()],
    )
    expect(pluginWindowDeclarations(missingAction)).toEqual([])

    const missingEvent = descriptor(
      { events: [{ type: "plugin:acme:other" }] },
      [declaration()],
    )
    expect(pluginWindowDeclarations(missingEvent)).toEqual([])

    const foreignEvent = descriptor({}, [declaration({ triggerEvent: "plugin:other:changed" })])
    expect(pluginWindowDeclarations(foreignEvent)).toEqual([])
  })

  test("triggers only match the exact declared event of the same package", () => {
    const declarationValue = declaration()
    expect(pluginWindowTriggersOn(declarationValue, "acme", "plugin:acme:changed")).toBe(true)
    expect(pluginWindowTriggersOn(declarationValue, "acme", "plugin:acme:other")).toBe(false)
    expect(pluginWindowTriggersOn(declarationValue, "beta", "plugin:acme:changed")).toBe(false)
  })

  test("view actions receive the neutral event payload", () => {
    expect(pluginWindowActionInput(event("plugin:acme:changed", { value: 2 }))).toEqual({
      event: { type: "plugin:acme:changed", properties: { value: 2 } },
    })
    expect(pluginWindowActionInput({ type: "plugin:acme:changed", sessionID: "s1" })).toEqual({
      event: { type: "plugin:acme:changed", properties: undefined },
      sessionID: "s1",
    })
  })
})

describe("plugin window state", () => {
  test("opens a singleton with normalized flags", () => {
    const state = open(EMPTY_PLUGIN_WINDOW_STATE)
    expect(state.windows).toHaveLength(1)
    const entry = state.windows[0]!
    expect(entry.key).toBe("acme:notice")
    expect(entry.package).toBe("acme")
    expect(entry.id).toBe("notice")
    expect(entry.trigger).toBe(1)
    expect(entry.modal).toBe(false)
    expect(entry.dismissible).toBe(true)
    expect(entry.event).toEqual(event())
    expect(state.focus).toEqual({ modalKey: null, token: 0 })
  })

  test("a repeated trigger updates the existing window instead of stacking", () => {
    const first = open(EMPTY_PLUGIN_WINDOW_STATE)
    const next = open(first, { event: event("plugin:acme:changed", { value: 2 }) })
    expect(next.windows).toHaveLength(1)
    expect(next.windows[0]!.trigger).toBe(2)
    expect(next.windows[0]!.event.properties).toEqual({ value: 2 })
    expect(next.focus.modalKey).toBeNull()
  })

  test("multiple declarations open independently and close individually", () => {
    const second = declaration({ id: "alert", title: "Alert", triggerEvent: "plugin:acme:other" })
    const acme = descriptor({}, [declaration(), second])
    const beta = descriptor({ name: "beta", revision: "beta@1" }, [
      declaration({ id: "beta-notice", triggerEvent: "plugin:beta:changed" }),
    ])
    beta.events = [{ type: "plugin:beta:changed" }]
    beta.actions = [{ name: "open" }]

    let state = open(EMPTY_PLUGIN_WINDOW_STATE, { descriptor: acme })
    state = open(state, {
      descriptor: acme,
      declaration: second,
      event: event("plugin:acme:other"),
    })
    state = open(state, {
      descriptor: beta,
      declaration: beta.ui.messageWindows![0]!,
      event: event("plugin:beta:changed"),
    })
    expect(state.windows.map((entry) => entry.key)).toEqual([
      "acme:notice",
      "acme:alert",
      "beta:beta-notice",
    ])

    state = closePluginWindow(state, "acme:alert")
    expect(state.windows.map((entry) => entry.key)).toEqual(["acme:notice", "beta:beta-notice"])
  })

  test("unknown or mismatched events are ignored without touching state", () => {
    const base = open(EMPTY_PLUGIN_WINDOW_STATE)
    const mismatched = open(base, { event: event("plugin:acme:other") })
    expect(mismatched).toBe(base)

    const mismatchedKey = open(base, { key: "other:notice" })
    expect(mismatchedKey).toBe(base)

    const undeclared = descriptor({ actions: [{ name: "act" }] }, [declaration()])
    expect(open(base, { descriptor: undeclared })).toBe(base)
  })

  test("dismissible defaults to true and false is preserved", () => {
    const modalState = open(EMPTY_PLUGIN_WINDOW_STATE, {
      declaration: declaration({ dismissible: false, modal: true }),
    })
    const entry = modalState.windows[0]!
    expect(entry.dismissible).toBe(false)
    expect(entry.modal).toBe(true)
  })

  test("modeless windows never take modal focus", () => {
    const betaDeclaration = declaration({ id: "b", triggerEvent: "plugin:beta:changed" })
    const beta = descriptor(
      {
        name: "beta",
        revision: "beta@1",
        actions: [{ name: "open" }],
        events: [{ type: "plugin:beta:changed" }],
      },
      [betaDeclaration],
    )
    let state = open(EMPTY_PLUGIN_WINDOW_STATE)
    state = open(state, {
      descriptor: beta,
      declaration: betaDeclaration,
      event: event("plugin:beta:changed"),
    })
    expect(state.windows).toHaveLength(2)
    expect(state.focus).toEqual({ modalKey: null, token: 0 })
  })
})

describe("modal focus ownership", () => {
  test("opening a modal takes focus and closing it releases focus", () => {
    const modal = declaration({ modal: true })
    let state = open(EMPTY_PLUGIN_WINDOW_STATE, { declaration: modal })
    expect(state.focus).toEqual({ modalKey: "acme:notice", token: 1 })

    state = closePluginWindow(state, "acme:notice")
    expect(state.windows).toEqual([])
    expect(state.focus).toEqual({ modalKey: null, token: 2 })
  })

  test("a second modal becomes the focus owner; closing it restores the first", () => {
    const first = declaration({ modal: true })
    const second = declaration({ id: "alert", modal: true, triggerEvent: "plugin:acme:other" })
    const acme = descriptor({}, [first, second])

    let state = open(EMPTY_PLUGIN_WINDOW_STATE, { descriptor: acme, declaration: first })
    expect(state.focus.modalKey).toBe("acme:notice")

    state = open(state, {
      descriptor: acme,
      declaration: second,
      event: event("plugin:acme:other"),
    })
    expect(state.focus).toEqual({ modalKey: "acme:alert", token: 2 })

    state = closePluginWindow(state, "acme:alert")
    expect(state.focus).toEqual({ modalKey: "acme:notice", token: 3 })
  })

  test("retriggering the focused modal does not re-steal focus", () => {
    const modal = declaration({ modal: true })
    let state = open(EMPTY_PLUGIN_WINDOW_STATE, { declaration: modal })
    expect(state.focus.token).toBe(1)
    state = open(state, { declaration: modal })
    expect(state.windows[0]!.trigger).toBe(2)
    expect(state.focus).toEqual({ modalKey: "acme:notice", token: 1 })
  })

  test("opening a modeless window while a modal is open keeps modal focus", () => {
    const modal = declaration({ modal: true })
    const alert = declaration({ id: "alert", triggerEvent: "plugin:acme:other" })
    const acme = descriptor({}, [modal, alert])
    let state = open(EMPTY_PLUGIN_WINDOW_STATE, { descriptor: acme, declaration: modal })
    state = open(state, {
      descriptor: acme,
      declaration: alert,
      event: event("plugin:acme:other"),
    })
    expect(state.focus).toEqual({ modalKey: "acme:notice", token: 1 })
  })

  test("focus cycling wraps forward and backward", () => {
    expect(cycleFocusIndex(-1, 3, false)).toBe(0)
    expect(cycleFocusIndex(-1, 3, true)).toBe(2)
    expect(cycleFocusIndex(2, 3, false)).toBe(0)
    expect(cycleFocusIndex(0, 3, true)).toBe(2)
    expect(cycleFocusIndex(0, 0, false)).toBe(-1)
  })
})

describe("descriptor revision cleanup", () => {
  test("removing the package closes its windows and releases focus", () => {
    const modal = declaration({ modal: true })
    const state = open(EMPTY_PLUGIN_WINDOW_STATE, { declaration: modal })
    const next = applyWindowRevision(state, [])
    expect(next.windows).toEqual([])
    expect(next.focus).toEqual({ modalKey: null, token: 2 })
  })

  test("removing only the declaration closes that window and keeps the rest", () => {
    const notice = declaration({ modal: true })
    const alert = declaration({ id: "alert", modal: true, triggerEvent: "plugin:acme:other" })
    const acme = descriptor({}, [notice, alert])
    let state = open(EMPTY_PLUGIN_WINDOW_STATE, { descriptor: acme, declaration: notice })
    state = open(state, {
      descriptor: acme,
      declaration: alert,
      event: event("plugin:acme:other"),
    })

    const withoutNotice = descriptor({}, [alert])
    const next = applyWindowRevision(state, [withoutNotice])
    expect(next.windows.map((entry) => entry.key)).toEqual(["acme:alert"])
    expect(next.focus).toEqual({ modalKey: "acme:alert", token: 2 })
  })

  test("a changed descriptor keeps a compatible window and updates it", () => {
    const state = open(EMPTY_PLUGIN_WINDOW_STATE)
    const nextDeclaration = declaration({ title: "Updated", viewAction: "act" })
    const nextDescriptor = descriptor({ revision: "acme@2" }, [nextDeclaration])
    const next = applyWindowRevision(state, [nextDescriptor])

    expect(next.windows).toHaveLength(1)
    const entry = next.windows[0]!
    expect(entry.descriptor.revision).toBe("acme@2")
    expect(entry.declaration.title).toBe("Updated")
    expect(entry.declaration.viewAction).toBe("act")
    expect(entry.trigger).toBe(1)
  })

  test("changing the trigger event is incompatible and closes the window", () => {
    const state = open(EMPTY_PLUGIN_WINDOW_STATE)
    const nextDeclaration = declaration({ triggerEvent: "plugin:acme:other" })
    const nextDescriptor = descriptor({ revision: "acme@2" }, [nextDeclaration])
    const next = applyWindowRevision(state, [nextDescriptor])
    expect(next.windows).toEqual([])
  })

  test("unchanged windows keep their entry and state identity", () => {
    const acme = descriptor()
    const state = open(EMPTY_PLUGIN_WINDOW_STATE, { descriptor: acme })
    expect(applyWindowRevision(state, [acme])).toBe(state)
    // A rebuilt but equivalent snapshot must not churn the window.
    const rebuilt = descriptor()
    const next = applyWindowRevision(state, [rebuilt])
    expect(next).toBe(state)
  })

  test("invalid snapshots are ignored (fail-open)", () => {
    const state = open(EMPTY_PLUGIN_WINDOW_STATE)
    expect(applyWindowRevision(state, null)).toBe(state)
    expect(applyWindowRevision(state, { plugins: "nope" } as any)).toBe(state)
  })
})

describe("DOM decision helpers", () => {
  const modal = (dismissible: boolean) => ({ modal: true, dismissible })
  const modeless = (dismissible: boolean) => ({ modal: false, dismissible })

  test("modal Esc closes only dismissible windows and always blocks", () => {
    expect(
      decidePluginWindowEscape({ modalKey: "acme:notice", entry: modal(true), focusInside: true }),
    ).toBe("close")
    // Non-dismissible modals still consume Esc so it cannot close anything
    // behind the blocking overlay.
    expect(
      decidePluginWindowEscape({ modalKey: "acme:notice", entry: modal(false), focusInside: true }),
    ).toBe("block")
    // A stale focus owner (window already gone) has nothing to block.
    expect(
      decidePluginWindowEscape({ modalKey: "acme:notice", entry: null, focusInside: false }),
    ).toBe("ignore")
  })

  test("modeless Esc closes only dismissible windows with focus inside the card", () => {
    expect(
      decidePluginWindowEscape({ modalKey: null, entry: modeless(true), focusInside: true }),
    ).toBe("close")
    expect(
      decidePluginWindowEscape({ modalKey: null, entry: modeless(true), focusInside: false }),
    ).toBe("ignore")
    expect(
      decidePluginWindowEscape({ modalKey: null, entry: modeless(false), focusInside: true }),
    ).toBe("ignore")
    expect(decidePluginWindowEscape({ modalKey: null, entry: null, focusInside: true })).toBe(
      "ignore",
    )
  })

  test("close button visibility and close/backdrop dismissal follow dismissible", () => {
    expect(shouldShowPluginWindowClose({ dismissible: true })).toBe(true)
    expect(shouldShowPluginWindowClose({ dismissible: false })).toBe(false)
    expect(shouldShowPluginWindowClose(null)).toBe(false)
    expect(decidePluginWindowDismiss({ dismissible: true })).toBe("close")
    expect(decidePluginWindowDismiss({ dismissible: false })).toBe("ignore")
    expect(decidePluginWindowDismiss(null)).toBe("ignore")
  })

  test("focus plan captures on the first modal and keeps the target while stacking", () => {
    const first = planPluginWindowFocus<string>({
      previousKey: null,
      nextKey: "a",
      restoreTarget: null,
      activeElement: "composer",
    })
    expect(first).toEqual({ restoreTarget: "composer", focusKey: "a", restoredTarget: null })

    const stacked = planPluginWindowFocus<string>({
      previousKey: "a",
      nextKey: "b",
      restoreTarget: first.restoreTarget,
      activeElement: "window-a",
    })
    // The original target survives opening a second modal.
    expect(stacked).toEqual({ restoreTarget: "composer", focusKey: "b", restoredTarget: null })

    const backToOne = planPluginWindowFocus<string>({
      previousKey: "b",
      nextKey: "a",
      restoreTarget: stacked.restoreTarget,
      activeElement: "window-b",
    })
    expect(backToOne).toEqual({ restoreTarget: "composer", focusKey: "a", restoredTarget: null })

    const closed = planPluginWindowFocus<string>({
      previousKey: "a",
      nextKey: null,
      restoreTarget: backToOne.restoreTarget,
      activeElement: "window-a",
    })
    expect(closed).toEqual({ restoreTarget: null, focusKey: null, restoredTarget: "composer" })
  })

  test("focus plan is inert without modals and tolerates a missing active element", () => {
    expect(
      planPluginWindowFocus<string>({
        previousKey: null,
        nextKey: null,
        restoreTarget: null,
        activeElement: "composer",
      }),
    ).toEqual({ restoreTarget: null, focusKey: null, restoredTarget: null })

    expect(
      planPluginWindowFocus<string>({
        previousKey: null,
        nextKey: "a",
        restoreTarget: null,
        activeElement: null,
      }),
    ).toEqual({ restoreTarget: null, focusKey: "a", restoredTarget: null })

    // Closing a modal without a saved target restores nothing.
    expect(
      planPluginWindowFocus<string>({
        previousKey: "a",
        nextKey: null,
        restoreTarget: null,
        activeElement: null,
      }),
    ).toEqual({ restoreTarget: null, focusKey: null, restoredTarget: null })
  })
})

describe("window view request state", () => {
  test("refresh keeps the last good view and failure only adds an error", () => {
    let state = beginWindowViewRequest(EMPTY_PLUGIN_WINDOW_VIEW_STATE, generation("boot-a:1"))
    state = settleWindowView(state, state.requestId, view)
    expect(state.status).toBe("ready")
    expect(state.view).toStrictEqual(view)

    state = beginWindowViewRequest(state, generation("boot-a:1"))
    expect(state.status).toBe("loading")
    expect(state.view).toStrictEqual(view)

    state = failWindowView(state, state.requestId, "boom")
    expect(state.status).toBe("error")
    expect(state.error).toBe("boom")
    expect(state.view).toStrictEqual(view)
  })

  test("stale request ids and invalid payloads never overwrite the view", () => {
    let state = beginWindowViewRequest(EMPTY_PLUGIN_WINDOW_VIEW_STATE, generation("boot-a:1"))
    state = settleWindowView(state, state.requestId, view)
    const previous = state
    expect(failWindowView(state, state.requestId - 1, "late")).toBe(previous)
    expect(settleWindowView(state, state.requestId - 1, view)).toBe(previous)

    state = beginWindowViewRequest(state, generation("boot-a:1"))
    state = settleWindowView(state, state.requestId, { nonsense: true })
    expect(state.status).toBe("error")
    expect(state.view).toStrictEqual(view)
  })

  test("an action view replaces the current view and invalidates in-flight refreshes", () => {
    let state = beginWindowViewRequest(EMPTY_PLUGIN_WINDOW_VIEW_STATE, generation("boot-a:1"))
    state = settleWindowView(state, state.requestId, view)
    const replaced: PluginView = { title: "New", body: [{ type: "text", text: "new" }] }
    const next = replaceWindowView(state, replaced)
    expect(next.view).toStrictEqual(replaced)
    expect(next.requestId).toBe(state.requestId + 1)
    expect(failWindowView(next, state.requestId, "late")).toBe(next)
  })

  test("action output is stored beside the view", () => {
    const state = setWindowActionOutput(EMPTY_PLUGIN_WINDOW_VIEW_STATE, "done")
    expect(state.actionOutput).toBe("done")
    expect(state.view).toBeNull()
  })
})

describe("window view fetch guards", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  test("a current response is normalized into a view", async () => {
    const result = await fetchPluginWindowView({
      invoke: async () => view,
      generation: () => generation("boot-a:1"),
      isGenerationCurrent: () => true,
    })
    expect(result.kind).toBe("view")
    if (result.kind === "view") expect(result.view).toStrictEqual(view)
  })

  test("a response from an older plugin generation is discarded", async () => {
    const pending = deferred<unknown>()
    const fetchPromise = fetchPluginWindowView({
      invoke: () => pending.promise,
      generation: () => generation("boot-a:1"),
      isGenerationCurrent: () => false,
    })
    pending.resolve(view)
    expect(await fetchPromise).toEqual({ kind: "stale" })
  })

  test("a response for a superseded window trigger is discarded", async () => {
    let identity = "acme:notice#1"
    const pending = deferred<unknown>()
    const fetchPromise = fetchPluginWindowView({
      invoke: () => pending.promise,
      generation: () => generation("boot-a:1"),
      isGenerationCurrent: () => true,
      identity: () => identity,
    })
    identity = "acme:notice#2"
    pending.resolve(view)
    expect(await fetchPromise).toEqual({ kind: "stale" })
  })

  test("errors keep the last good view and invalid payloads are reported", async () => {
    const failed = await fetchPluginWindowView({
      invoke: async () => {
        throw new Error("offline")
      },
      generation: () => generation("boot-a:1"),
      isGenerationCurrent: () => true,
    })
    expect(failed).toEqual({ kind: "error", message: "offline" })

    const invalid = await fetchPluginWindowView({
      invoke: async () => ({ not: "a view" }),
      generation: () => generation("boot-a:1"),
      isGenerationCurrent: () => true,
    })
    expect(invalid).toEqual({ kind: "error", message: "插件视图格式无效" })
  })

  test("window identity covers the key, trigger, action and revision", () => {
    const state = open(EMPTY_PLUGIN_WINDOW_STATE)
    const entry = state.windows[0]!
    expect(pluginWindowIdentity(entry)).toBe("acme:notice#1:open:acme@1")
  })
})
