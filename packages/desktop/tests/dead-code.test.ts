import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// deferred minors：新布局落地后遗留的死代码必须清掉，避免下一个人误接线。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("dead code 清理", () => {
  test("UsagePill 组件已删除（右 dock「用量」tab 取代）", () => {
    expect(existsSync(join(root, "src/renderer/mafw/components/UsagePill.tsx"))).toBe(false)
  })
  test("旧窄屏断点文件已删除（右 dock 不再自动 overlay）", () => {
    expect(existsSync(join(root, "src/renderer/mafw/layout-breakpoints.ts"))).toBe(false)
  })
  test("applyRightDockWidth 死函数已删除", () => {
    expect(read("src/renderer/mafw/MafwShell.tsx")).not.toContain("applyRightDockWidth")
  })
  test("旧 .mafw-rail 根样式已删除（LeftDock 仍用 .mafw-rail-* 系列）", () => {
    const css = read("src/renderer/mafw/mafw.css")
    expect(css).not.toMatch(/\.mafw-rail\s*\{/)
  })

  test("Dashboard 与 PodRailFace 已退役", () => {
    expect(existsSync(join(root, "src/renderer/mafw/pages/Dashboard.tsx"))).toBe(false)
    expect(existsSync(join(root, "src/renderer/mafw/components/PodRailFace.tsx"))).toBe(false)
    expect(existsSync(join(root, "src/renderer/mafw/components/PodAttentionList.tsx"))).toBe(false)
    expect(existsSync(join(root, "src/renderer/mafw/components/PodResultPanel.tsx"))).toBe(false)
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).not.toContain("pages/Dashboard")
    expect(shell).not.toContain("PodRailFace")
  })

  test("PodDock 不再承载第二个 Goal 列表、任务板或结果面板", () => {
    const dock = read("src/renderer/mafw/components/PodDock.tsx")
    expect(dock).not.toContain("PodGoalQueue")
    expect(dock).not.toContain("PodTaskBoard")
    expect(dock).not.toContain("PodResultPanel")
    expect(dock).not.toContain("PodGoalComposer")
    expect(dock).not.toContain("PodAttentionList")
  })

  test("项目团队条取代左栏 Pod 资源面", () => {
    expect(existsSync(join(root, "src/renderer/mafw/components/ProjectResources.tsx"))).toBe(false)
    const team = read("src/renderer/mafw/components/ProjectTeamStrip.tsx")
    expect(team).toContain("mafw-project-team-strip")
    expect(team).toContain("团队")
    expect(team).toContain("邮箱")
    expect(team).toContain("记忆")
    expect(team).toContain("onOpenPanel")
    expect(team).not.toContain("PAGE_LINKS")
  })

  test("WorldOverviewStage 承载 New Goal composer，不再从 PodDock 或全页工作空间创建", () => {
    const work = read("src/renderer/mafw/components/WorldOverviewStage.tsx")
    expect(work).toContain("PodGoalComposer")
    expect(work).toContain("pod.createGoal")
    expect(existsSync(join(root, "src/renderer/mafw/components/WorkspaceHome.tsx"))).toBe(false)
  })
})
