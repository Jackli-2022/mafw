import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  documentToolbarProvider,
  registerDocumentToolbar,
  resetDocumentToolbarRegistryForTests,
} from "./document-toolbar-registry"

const provider = (label: string) => () => ({ ariaLabel: label })

beforeEach(() => resetDocumentToolbarRegistryForTests())

test("registers a provider per kind and unregisters only its own", () => {
  const file = provider("file")
  const web = provider("web")
  const offFile = registerDocumentToolbar("file", file)
  registerDocumentToolbar("web", web)

  assert.equal(documentToolbarProvider("file"), file)
  assert.equal(documentToolbarProvider("web"), web)

  offFile()
  assert.equal(documentToolbarProvider("file"), null)
  assert.equal(documentToolbarProvider("web"), web)

  offFile()
  assert.equal(documentToolbarProvider("web"), web)
})

test("unregistering an older provider does not remove its replacement", () => {
  const first = provider("first")
  const second = provider("second")
  const offFirst = registerDocumentToolbar("file", first)
  registerDocumentToolbar("file", second)

  offFirst()

  assert.equal(documentToolbarProvider("file"), second)
})

test("reset clears both kinds", () => {
  registerDocumentToolbar("file", provider("file"))
  registerDocumentToolbar("web", provider("web"))

  resetDocumentToolbarRegistryForTests()

  assert.equal(documentToolbarProvider("file"), null)
  assert.equal(documentToolbarProvider("web"), null)
})

test("registers a diff toolbar provider", () => {
  const diff = provider("diff")
  const off = registerDocumentToolbar("diff", diff)
  assert.equal(documentToolbarProvider("diff"), diff)
  off()
  assert.equal(documentToolbarProvider("diff"), null)
})
