import { describe, expect, test } from "bun:test"
import { planManagedGatewaySpawn } from "./managed-gateway-spawn"

describe("managed gateway spawn plan", () => {
  test("packaged uses the Electron binary in Node mode", () => {
    const plan = planManagedGatewaySpawn({
      packaged: true,
      execPath: "C:/app/electron.exe",
      nodeBin: "C:/node/node.exe",
      entry: "C:/app/resources/gateway/dist/index.js",
      env: { PATH: "x" },
    })
    expect(plan.command).toBe("C:/app/electron.exe")
    expect(plan.args).toEqual(["C:/app/resources/gateway/dist/index.js"])
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBe("1")
  })

  test("dev uses system Node and never Electron-as-Node (repository Node ABI)", () => {
    const plan = planManagedGatewaySpawn({
      packaged: false,
      execPath: "C:/app/electron.exe",
      nodeBin: "C:/node/node.exe",
      entry: "C:/repo/gateway/dist/index.js",
      env: { PATH: "x", ELECTRON_RUN_AS_NODE: "1" },
    })
    expect(plan.command).toBe("C:/node/node.exe")
    expect(plan.args).toEqual(["C:/repo/gateway/dist/index.js"])
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  test("dev falls back to `node` when no explicit bin is configured", () => {
    const plan = planManagedGatewaySpawn({
      packaged: false,
      execPath: "C:/app/electron.exe",
      entry: "C:/repo/gateway/dist/index.js",
      env: {},
    })
    expect(plan.command).toBe("node")
  })
})
