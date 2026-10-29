import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("preload exposes the pod namespace", () => {
  const api = read("src/preload/mafw-api.ts")
  const types = read("src/preload/mafw-types.ts")
  assert.ok(api.includes("pod: {"))
  assert.ok(api.includes('invoke("pod", "ensure"'))
  assert.ok(api.includes('invoke("pod", "updateTask"'))
  assert.ok(types.includes("pod: PodNamespace"))
})
