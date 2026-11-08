import { describe, expect, test } from "bun:test"
import { PERMISSION_MODES } from "./permission-card-mapping"
import { permissionPresentation, PERMISSION_PRESENTATION } from "./composer-permission"

// 2026-11-09 composer 收敛：权限三档改成常驻图标（无文字），
// 所以形状必须彼此可辨（色盲）、颜色必须有语义、hover 必须有解释。
describe("composer permission presentation", () => {
  test("three modes use three distinct icon shapes", () => {
    const icons = PERMISSION_MODES.map((m) => permissionPresentation(m).icon)
    expect(icons).toEqual(["eye", "shield", "warning"])
    expect(new Set(icons).size).toBe(3)
  })

  test("three modes use three distinct tones", () => {
    const tones = PERMISSION_MODES.map((m) => permissionPresentation(m).tone)
    expect(tones).toEqual(["muted", "accent", "danger"])
  })

  test("every mode carries a short label for menus/aria", () => {
    expect(permissionPresentation("read-only").label).toBe("只读")
    expect(permissionPresentation("auto").label).toBe("自动")
    expect(permissionPresentation("full-access").label).toBe("全开")
  })

  test("hover hint explains the mode and names the next one", () => {
    expect(permissionPresentation("read-only").hint).toContain("只读")
    expect(permissionPresentation("read-only").hint).toContain("自动")
    expect(permissionPresentation("auto").hint).toContain("全开")
    expect(permissionPresentation("full-access").hint).toContain("只读")
  })

  test("legacy / unknown values fall back to read-only (never lose the safety default)", () => {
    expect(permissionPresentation("manual").icon).toBe("eye")
    expect(permissionPresentation(undefined).icon).toBe("eye")
    expect(permissionPresentation("bogus").tone).toBe("muted")
  })

  test("presentation table covers every declared mode", () => {
    for (const mode of PERMISSION_MODES) expect(PERMISSION_PRESENTATION[mode]).toBeDefined()
  })
})
