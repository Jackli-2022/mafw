import { describe, test, expect } from "bun:test"
import {
  isLeadRole,
  leadTabMetadata,
  planLeadTabRestore,
  resolveLeadSession,
  tabSessionRole,
} from "./lead-session"

describe("lead-session", () => {
  test("lead is the only current coordinator role", () => {
    expect(isLeadRole("lead")).toBe(true)
    expect(isLeadRole("manager")).toBe(false)
    expect(isLeadRole("manager-archived")).toBe(false)
    expect(isLeadRole(undefined)).toBe(false)
  })

  test("historical manager metadata stays ordinary history", () => {
    expect(tabSessionRole({ metadata: { mafw: { role: "manager" } } })).toBe("manager")
    expect(tabSessionRole({ metadata: { mafw: { role: "manager-archived" } } })).toBe("manager-archived")
    expect(tabSessionRole({ lead: true })).toBe("lead")
    expect(tabSessionRole({ lead: false })).toBeUndefined()
  })

  test("resolved Lead uses the supplied coordinated session id", () => {
    const out = resolveLeadSession({ leadSessionId: "ses_lead" })
    expect(out).toMatchObject({
      id: "ses_lead",
      title: "Lead",
      lead: true,
      metadata: leadTabMetadata(),
    })
  })

  test("no lead id means no fallback to historical manager", () => {
    expect(resolveLeadSession({ leadSessionId: null })).toBeNull()
    expect(resolveLeadSession({})).toBeNull()
  })

  test("a stale persisted Lead id is replaced by the current Lead", () => {
    expect(planLeadTabRestore({
      currentLeadId: "ses_current",
      savedLeadTabs: [{ id: "ses_old", active: true }],
    })).toEqual({
      skip: ["ses_old"],
      open: "ses_current",
      activate: true,
      pending: false,
    })
  })

  test("the current Lead tab is left in place", () => {
    expect(planLeadTabRestore({
      currentLeadId: "ses_current",
      savedLeadTabs: [{ id: "ses_current", active: true }],
    })).toEqual({
      skip: [],
      open: null,
      activate: true,
      pending: false,
    })
  })

  test("a persisted Lead tab waits for the Pod before it is resolved", () => {
    expect(planLeadTabRestore({
      currentLeadId: null,
      savedLeadTabs: [{ id: "ses_old", active: true }],
    })).toEqual({
      skip: ["ses_old"],
      open: null,
      activate: false,
      pending: true,
    })
  })

  test("no saved Lead tab means no restore or reconcile work", () => {
    expect(planLeadTabRestore({
      currentLeadId: "ses_current",
      savedLeadTabs: [],
    })).toEqual({
      skip: [],
      open: null,
      activate: false,
      pending: false,
    })
  })
})
