import { describe, expect, test } from "bun:test"
import { planGatewayStart } from "./mafw-gateway-plan"

describe("planGatewayStart", () => {
  test("adopts an already-running gateway over every other option", () => {
    const plan = planGatewayStart({
      adoptUrl: "http://127.0.0.1:3000",
      bundledEntry: "C:/app/resources/gateway/dist/index.js",
      cliAvailable: true,
    })
    expect(plan).toEqual({ mode: "adopt", url: "http://127.0.0.1:3000" })
  })

  test("spawns the bundled gateway when nothing is running", () => {
    const plan = planGatewayStart({
      adoptUrl: null,
      bundledEntry: "C:/app/resources/gateway/dist/index.js",
      cliAvailable: true,
    })
    expect(plan).toEqual({ mode: "bundle", entry: "C:/app/resources/gateway/dist/index.js" })
  })

  test("falls back to the mafw CLI when no bundle is staged (dev)", () => {
    const plan = planGatewayStart({ adoptUrl: null, bundledEntry: null, cliAvailable: true })
    expect(plan).toEqual({ mode: "cli" })
  })

  test("fails when no gateway source is available", () => {
    const plan = planGatewayStart({ adoptUrl: null, bundledEntry: null, cliAvailable: false })
    expect(plan.mode).toBe("failed")
  })
})
