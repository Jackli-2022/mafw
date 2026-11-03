import { describe, expect, test } from "bun:test"
import { describePackageAction } from "./package-action-feedback"

describe("describePackageAction", () => {
  test("a plain applied result reports plain success", () => {
    expect(describePackageAction({ name: "acme", application: "applied" }, "应用")).toEqual({
      description: "应用 acme 成功",
      isError: false,
    })
  })

  test("a pending result never claims the new revision is live", () => {
    const message = describePackageAction(
      { name: "acme", application: "pending", pendingRevision: "boot:9" },
      "应用",
    )
    expect(message.isError).toBe(false)
    expect(message.description).toContain("已保存")
    expect(message.description).toContain("待应用")
    expect(message.description).not.toContain("成功")
  })

  test("a failed result carries the manager error", () => {
    expect(describePackageAction({ name: "acme", application: "failed", error: "boom" }, "应用")).toEqual({
      description: "应用 acme 失败：boom",
      isError: true,
    })
  })

  test("an applied runtime package says the runtime switched", () => {
    const message = describePackageAction(
      { name: "acme", application: "applied", runtimeSwitch: "applied" },
      "应用",
    )
    expect(message.isError).toBe(false)
    expect(message.description).toContain("运行时已切换")
  })

  test("a failed runtime switch is surfaced as an error with the switch reason", () => {
    const message = describePackageAction(
      { name: "acme", application: "applied", runtimeSwitch: "failed", runtimeError: "offline" },
      "重新加载",
    )
    expect(message.isError).toBe(true)
    expect(message.description).toContain("offline")
  })

  test("a required runtime switch is a manual, non-error signal", () => {
    const message = describePackageAction(
      { name: "acme", application: "applied", runtimeSwitch: "required" },
      "启用",
    )
    expect(message.isError).toBe(false)
    expect(message.description).toContain("需手动切换运行时")
  })

  test("a void result still reports the action", () => {
    expect(describePackageAction(undefined, "删除")).toEqual({
      description: "删除成功",
      isError: false,
    })
  })
})
