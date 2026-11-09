import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  gatewayInstanceRecordPath,
  gatewayInstanceRegistryRoot,
  readGatewayInstanceRecords,
  removeGatewayInstanceRecord,
  writeGatewayInstanceRecord,
} from "./gateway-instance-registry"
import type { GatewayInstanceRecord } from "./gateway-instance-record"

const record: GatewayInstanceRecord = {
  instanceId: "instance-1",
  pid: 4242,
  channel: "prod",
  gatewayVersion: "5.2.0",
  schemaEpoch: 1,
  startedAt: "2026-11-09T00:00:00.000Z",
  nonce: "nonce-1",
}

describe("gateway instance registry", () => {
  test("uses a shared channel-scoped path under ~/.mafw", () => {
    const root = gatewayInstanceRegistryRoot("C:/Users/example")
    expect(root).toContain(join(".mafw", "runtime", "desktop-gateway"))
    expect(gatewayInstanceRecordPath(root, "prod", "instance-1")).toBe(join(root, "prod", "instance-1.json"))
  })

  test("writes one readable record atomically and ignores malformed entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "mafw-instances-"))
    try {
      await writeGatewayInstanceRecord(root, record)
      const file = gatewayInstanceRecordPath(root, record.channel, record.instanceId)
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(record)

      mkdirSync(join(root, "prod"), { recursive: true })
      writeFileSync(join(root, "prod", "broken.json"), "{not-json")
      writeFileSync(join(root, "prod", "partial.json"), JSON.stringify({ instanceId: "partial" }))

      expect(await readGatewayInstanceRecords(root, "prod")).toEqual([record])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("remove is idempotent", async () => {
    const root = mkdtempSync(join(tmpdir(), "mafw-instances-"))
    try {
      await writeGatewayInstanceRecord(root, record)
      await removeGatewayInstanceRecord(root, record)
      await removeGatewayInstanceRecord(root, record)
      expect(await readGatewayInstanceRecords(root, "prod")).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
