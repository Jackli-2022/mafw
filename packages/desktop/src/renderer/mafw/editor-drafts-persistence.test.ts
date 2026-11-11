import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearAllDrafts,
  clearDraft,
  configureEditorDraftStorage,
  flushEditorDrafts,
  getDraft,
  getEol,
  getMtime,
  setDraft,
  setEol,
  setMtime,
} from "./editor-drafts"

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    data,
  }
}

test("drafts, mtimes and EOL survive a renderer restart per root", () => {
  const io = fakeStorage()
  configureEditorDraftStorage(io)
  clearAllDrafts()

  setDraft("C:\\work\\a", "src/a.ts", "draft-a")
  setMtime("C:\\work\\a", "src/a.ts", 123)
  setEol("C:\\work\\a", "src/a.ts", "\r\n")
  setDraft("C:\\work\\b", "src/a.ts", "draft-b")
  flushEditorDrafts()

  clearAllDrafts()
  configureEditorDraftStorage(io)
  assert.equal(getDraft("C:\\work\\a", "src/a.ts"), "draft-a")
  assert.equal(getMtime("C:\\work\\a", "src/a.ts"), 123)
  assert.equal(getEol("C:\\work\\a", "src/a.ts"), "\r\n")
  assert.equal(getDraft("C:\\work\\b", "src/a.ts"), "draft-b")
})

test("clearing a draft removes it from persisted state", () => {
  const io = fakeStorage()
  configureEditorDraftStorage(io)
  clearAllDrafts()
  setDraft("C:\\work\\a", "a.ts", "draft")
  flushEditorDrafts("C:\\work\\a")
  clearDraft("C:\\work\\a", "a.ts")
  flushEditorDrafts("C:\\work\\a")
  clearAllDrafts()
  configureEditorDraftStorage(io)
  assert.equal(getDraft("C:\\work\\a", "a.ts"), undefined)
})

test("no storage keeps the in-memory behavior", () => {
  configureEditorDraftStorage(null)
  clearAllDrafts()
  setDraft("C:\\work\\a", "a.ts", "memory")
  assert.equal(getDraft("C:\\work\\a", "a.ts"), "memory")
})
