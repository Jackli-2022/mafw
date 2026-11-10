import { describe, expect, test } from "bun:test"
import { planGatewayStart } from "./mafw-gateway-plan"
import type { GatewayHealthSnapshot, GatewayInstanceRecord, GatewayReleaseExpectation } from "./gateway-handshake"

const expected: GatewayReleaseExpectation = {
  gatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  channel: "prod",
}
const bundled = "C:/app/resources/gateway/dist/index.js"
const cliOk = { available: true as const, version: "5.1.0" }
const cliMissing = { available: false as const, reason: "not found" }
const health: GatewayHealthSnapshot = {
  status: "ok",
  gatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  channel: "prod",
  instanceId: "instance-1",
  distribution: "desktop-managed",
}
const record: GatewayInstanceRecord = {
  instanceId: "instance-1",
  pid: 4242,
  channel: "prod",
  gatewayVersion: "5.2.0",
  schemaEpoch: 1,
  startedAt: "2026-11-09T00:00:00.000Z",
  nonce: "nonce-1",
}

function input(overrides: Partial<Parameters<typeof planGatewayStart>[0]> = {}) {
  return {
    packaged: true,
    preference: "managed" as const,
    expected,
    bundledEntry: bundled,
    managedEntry: null,
    externalCli: cliMissing,
    running: { kind: "none" as const },
    legacyExternalOverride: false,
    ...overrides,
  }
}

describe("planGatewayStart", () => {
  test("packaged managed with no running gateway spawns the bundled entry", () => {
    expect(planGatewayStart(input())).toEqual({ mode: "managed", entry: bundled, action: "spawn" })
  })

  test("managed adopts only a matching registered instance", () => {
    expect(planGatewayStart(input({
      running: { kind: "gateway", health, managedInstance: record },
    }))).toEqual({ mode: "managed", entry: bundled, action: "adopt", instanceId: "instance-1" })
  })

  test("managed never silently adopts an unregistered running gateway", () => {
    const plan = planGatewayStart(input({
      running: { kind: "gateway", health, managedInstance: null },
    }))
    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("external-unregistered")
  })

  test("managed replaces an older registered instance and refuses a newer one", () => {
    expect(planGatewayStart(input({
      running: {
        kind: "gateway",
        health: { ...health, gatewayVersion: "5.1.9", instanceId: "old" },
        managedInstance: { ...record, instanceId: "old", gatewayVersion: "5.1.9" },
      },
    }))).toEqual({ mode: "managed", entry: bundled, action: "spawn" })

    const newer = planGatewayStart(input({
      running: {
        kind: "gateway",
        health: { ...health, gatewayVersion: "5.2.1", instanceId: "new" },
        managedInstance: { ...record, instanceId: "new", gatewayVersion: "5.2.1" },
      },
    }))
    expect(newer.mode).toBe("conflict")
    expect(newer.mode === "conflict" ? newer.reason : null).toBe("managed-newer")
  })

  test("dev managed adopts a running standalone gateway instead of conflicting", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: true,
      running: {
        kind: "gateway",
        health: {
          ...health,
          instanceId: "standalone-1",
          distribution: "standalone",
          channel: "standalone",
        },
        managedInstance: null,
      },
    }))

    expect(plan).toEqual({
      mode: "managed",
      entry: "C:/repo/gateway/dist/index.js",
      action: "adopt",
    })
  })

  test("dev managed refuses a running standalone gateway older than the repo build", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: true,
      running: {
        kind: "gateway",
        health: {
          ...health,
          gatewayVersion: "5.1.0",
          instanceId: "standalone-old",
          distribution: "standalone",
          channel: "standalone",
        },
        managedInstance: null,
      },
    }))

    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("gateway-outdated")
    if (plan.mode === "conflict") {
      expect(plan.detail).toContain("5.1.0")
      expect(plan.detail).toContain("5.2.0")
      expect(plan.detail).toContain("restart")
    }
  })

  test("dev managed refuses a running standalone gateway with a different schema epoch", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: true,
      running: {
        kind: "gateway",
        health: { ...health, schemaEpoch: 2, distribution: "standalone" },
        managedInstance: null,
      },
    }))

    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("schema-mismatch")
  })

  test("dev managed refuses a running standalone gateway with an incompatible experience contract", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: true,
      running: {
        kind: "gateway",
        health: {
          ...health,
          experienceVersion: "2020.01.0",
          minimumClientExperienceVersion: "2020.01.0",
          distribution: "standalone",
        },
        managedInstance: null,
      },
    }))

    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("experience-incompatible")
  })

  test("dev managed refuses an unversioned legacy gateway without an explicit override", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: true,
      running: {
        kind: "gateway",
        health: { status: "ok" },
        managedInstance: null,
      },
    }))

    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("legacy-external-unverified")
  })

  test("dev without adoption reports the running gateway instead of spawning into an occupied port", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: false,
      running: {
        kind: "gateway",
        health: { ...health, distribution: "standalone" },
        managedInstance: null,
      },
    }))

    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("gateway-running")
    if (plan.mode === "conflict") expect(plan.detail).toContain("mafw stop")
  })

  test("dev managed still refuses a running gateway that does not answer as a gateway", () => {
    const plan = planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
      devAdoptRunningGateway: true,
      running: { kind: "port-conflict" },
    }))
    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("port-conflict")
  })

  test("packaged managed never adopts an unregistered gateway even when dev adoption is requested", () => {
    const plan = planGatewayStart(input({
      devAdoptRunningGateway: true,
      running: { kind: "gateway", health, managedInstance: null },
    }))
    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("external-unregistered")
  })

  test("a non-gateway port conflict is surfaced instead of killed", () => {    const plan = planGatewayStart(input({ running: { kind: "port-conflict" } }))
    expect(plan.mode).toBe("conflict")
    expect(plan.mode === "conflict" ? plan.reason : null).toBe("port-conflict")
  })

  test("legacy external requires an explicit one-time override", () => {
    const legacyRunning = { kind: "gateway" as const, health: { status: "ok" }, managedInstance: null }
    const blocked = planGatewayStart(input({
      preference: "external",
      running: legacyRunning,
    }))
    expect(blocked.mode).toBe("conflict")
    expect(blocked.mode === "conflict" ? blocked.reason : null).toBe("legacy-external-unverified")

    expect(planGatewayStart(input({
      preference: "external",
      running: legacyRunning,
      legacyExternalOverride: true,
    }))).toEqual({
      mode: "external",
      transport: "url",
      url: "http://127.0.0.1:3000",
      warning: "legacy-unverified",
    })
  })

  test("dev managed uses the repository entry, packaged managed needs a bundle", () => {
    expect(planGatewayStart(input({
      packaged: false,
      managedEntry: "C:/repo/gateway/dist/index.js",
    }))).toEqual({
      mode: "managed",
      entry: "C:/repo/gateway/dist/index.js",
      action: "spawn",
    })
    expect(planGatewayStart(input({ bundledEntry: null })).mode).toBe("failed")
  })

  test("external without a URL may start the CLI gateway", () => {
    expect(planGatewayStart(input({
      preference: "external",
      externalCli: cliOk,
    }))).toEqual({
      mode: "external",
      transport: "cli",
      url: null,
      warning: null,
    })
  })
})
