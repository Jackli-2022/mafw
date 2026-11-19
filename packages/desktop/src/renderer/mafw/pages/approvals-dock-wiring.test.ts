import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("ApprovalsPage has a compact dock mode and wrapping action rows", () => {
  const page = read("ApprovalsPage.tsx")
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /class="mafw-approvals-page"/)
  assert.match(page, /classList=\{\{ "is-compact": !!props\.compact \}\}/)
  assert.match(page, /when=\{!props\.compact\}/)
  assert.match(page, /class="mafw-approvals-actions"/)
})

test("ApprovalsPage keeps the human reply callbacks untouched", () => {
  const page = read("ApprovalsPage.tsx")
  assert.match(page, /onPermissionReply\?: \(card: any, reply: "once" \| "always" \| "reject"/)
  assert.match(page, /props\.onPermissionReply\?\.\(p, "once"\)/)
  assert.match(page, /props\.onPermissionReply\?\.\(p, "always"\)/)
  assert.match(page, /props\.onPermissionReply\?\.\(p, "reject"\)/)
})

test("approvals opens in the right workbench from the rail and renderPage", () => {
  const shell = read("../MafwShell.tsx")
  assert.match(shell, /onApprovals=\{\(\) => openPageFocus\("approvals"\)\}/)
  assert.match(
    shell,
    /case "approvals":\s*\n\s*return <ApprovalsPage compact permissionCards=\{pendingPermissionCards\} onPermissionReply=\{permReply\} \/>/,
  )
})
