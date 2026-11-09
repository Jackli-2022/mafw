import { describe, expect, test } from "bun:test"
import { updaterBannerModel } from "./updater-banner-model"

describe("updater banner model", () => {
  test("quiet states do not interrupt the user", () => {
    for (const state of [
      { status: "disabled" as const },
      { status: "idle" as const },
      { status: "checking" as const },
      { status: "downloading" as const, version: "5.2.0" },
      { status: "up-to-date" as const },
      { status: "error" as const, message: "offline" },
    ]) {
      expect(updaterBannerModel(state).visible).toBe(false)
    }
  })

  test("ready shows the version and one install action", () => {
    expect(updaterBannerModel({ status: "ready", version: "5.2.0" })).toEqual({
      visible: true,
      title: "更新已下载",
      detail: "MAFW 5.2.0 将在重启后安装",
      action: "install",
    })
  })
})
