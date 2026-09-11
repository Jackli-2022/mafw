import { describe, expect, test } from "bun:test"
import { planGatewayStart } from "./mafw-gateway-plan"

const cliOk = { available: true as const, version: "4.1.0" }
const cliMissing = { available: false as const, reason: "not found" }
const bundled = "C:/app/resources/gateway/dist/index.js"

describe("planGatewayStart", () => {
  test("adopts an already-running gateway over every other option", () => {
    const plan = planGatewayStart({
      adoptUrl: "http://127.0.0.1:3000",
      cliProbe: cliOk,
      bundledEntry: bundled,
    })
    expect(plan).toEqual({ mode: "adopt", url: "http://127.0.0.1:3000" })
  })

  test("prefers a probed mafw CLI over the bundled gateway (user install wins)", () => {
    const plan = planGatewayStart({ adoptUrl: null, cliProbe: cliOk, bundledEntry: bundled })
    expect(plan).toEqual({ mode: "cli" })
  })

  test("spawns the bundled gateway when the CLI probe fails", () => {
    const plan = planGatewayStart({ adoptUrl: null, cliProbe: cliMissing, bundledEntry: bundled })
    expect(plan).toEqual({ mode: "bundle", entry: bundled })
  })

  test("falls back to the mafw CLI when no bundle is staged (dev)", () => {
    const plan = planGatewayStart({ adoptUrl: null, cliProbe: cliOk, bundledEntry: null })
    expect(plan).toEqual({ mode: "cli" })
  })

  test("fails when no gateway source is available", () => {
    const plan = planGatewayStart({ adoptUrl: null, cliProbe: cliMissing, bundledEntry: null })
    expect(plan.mode).toBe("failed")
  })
})
