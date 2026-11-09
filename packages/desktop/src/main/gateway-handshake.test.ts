import { describe, expect, test } from "bun:test"
import { negotiateGateway, type GatewayHealthSnapshot, type GatewayReleaseExpectation } from "./gateway-handshake"

const expected: GatewayReleaseExpectation = {
  gatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  channel: "prod",
}

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

describe("negotiateGateway", () => {
  test("managed exact version, schema, channel and instance is accepted", () => {
    expect(negotiateGateway({
      mode: "managed",
      health,
      expected,
      expectedInstanceId: "instance-1",
    })).toEqual({ ok: true, exactVersion: true })
  })

  test("managed older is older-than-required and newer is newer-than-desktop", () => {
    expect(negotiateGateway({
      mode: "managed",
      health: { ...health, gatewayVersion: "5.1.9" },
      expected,
      expectedInstanceId: "instance-1",
    })).toEqual({ ok: false, reason: "older-than-required" })
    expect(negotiateGateway({
      mode: "managed",
      health: { ...health, gatewayVersion: "5.2.1" },
      expected,
      expectedInstanceId: "instance-1",
    })).toEqual({ ok: false, reason: "newer-than-desktop" })
  })

  test("managed matching version with a different registered instance is rejected", () => {
    expect(negotiateGateway({
      mode: "managed",
      health,
      expected,
      expectedInstanceId: "instance-other",
    })).toEqual({ ok: false, reason: "instance-mismatch" })
  })

  test("external newer with the same schema and compatible Experience is accepted non-exactly", () => {
    expect(negotiateGateway({
      mode: "external",
      health: {
        ...health,
        gatewayVersion: "5.3.0",
        experienceVersion: "2026.11.2",
        distribution: "standalone",
      },
      expected,
    })).toEqual({ ok: true, exactVersion: false })
  })

  test("external legacy response without version fields is identified", () => {
    expect(negotiateGateway({
      mode: "external",
      health: { status: "ok" },
      expected,
    })).toEqual({ ok: false, reason: "legacy-unversioned" })
  })

  test("external Experience incompatibility is rejected", () => {
    expect(negotiateGateway({
      mode: "external",
      health: {
        ...health,
        experienceVersion: "2026.10.9",
        distribution: "standalone",
      },
      expected,
    })).toEqual({ ok: false, reason: "experience-incompatible" })
    expect(negotiateGateway({
      mode: "external",
      health: {
        ...health,
        minimumClientExperienceVersion: "2026.12.0",
        distribution: "standalone",
      },
      expected,
    })).toEqual({ ok: false, reason: "experience-incompatible" })
  })
})
